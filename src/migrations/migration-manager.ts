/**
 * Система миграций для SurrealDB ORM
 */

import type { QueryEngine } from '../core/query-engine.js';
import type { ILogger } from '../helpers.js';
import { MigrationError } from '../errors/index.js';

// Тип миграции
export interface Migration {
  version: string;
  name: string;
  description?: string;
  up: (queryEngine: QueryEngine) => Promise<void>;
  down: (queryEngine: QueryEngine) => Promise<void>;
  dependencies?: string[];
  rollbackable?: boolean;
}

// Статус миграции
export interface MigrationStatus {
  version: string;
  name: string;
  applied: boolean;
  appliedAt?: string;
  rolledBackAt?: string;
  error?: string;
}

// План миграции
export interface MigrationPlan {
  toApply: Migration[];
  toRollback: Migration[];
  conflicts: string[];
  estimatedTime: number;
}

// Менеджер миграций
export class MigrationManager {
  private migrations: Map<string, Migration> = new Map();
  private appliedMigrations: Set<string> = new Set();
  private logger: ILogger;

  constructor(
    private queryEngine: QueryEngine,
    logger: ILogger
  ) {
    this.logger = logger;
  }

  /**
   * Регистрация миграции
   */
  registerMigration(migration: Migration): void {
    if (this.migrations.has(migration.version)) {
      throw new MigrationError(`Migration ${migration.version} already registered`);
    }

    this.migrations.set(migration.version, migration);
    this.logger.info({ module: 'MigrationManager', method: 'registerMigration' }, 
      `Migration registered: ${migration.version} - ${migration.name}`);
  }

  /**
   * Регистрация нескольких миграций
   */
  registerMigrations(migrations: Migration[]): void {
    for (const migration of migrations) {
      this.registerMigration(migration);
    }
  }

  /**
   * Инициализация системы миграций
   */
  async initialize(): Promise<void> {
    try {
      // Создание таблицы для отслеживания миграций
      await this.queryEngine.query(`
        DEFINE TABLE IF NOT EXISTS _migrations SCHEMALESS;
        DEFINE FIELD version ON TABLE _migrations TYPE string ASSERT $value != NONE;
        DEFINE FIELD name ON TABLE _migrations TYPE string ASSERT $value != NONE;
        DEFINE FIELD applied_at ON TABLE _migrations TYPE datetime;
        DEFINE FIELD rolled_back_at ON TABLE _migrations TYPE datetime;
        DEFINE INDEX idx_version ON TABLE _migrations FIELDS version UNIQUE;
      `);

      // Загрузка информации о примененных миграциях
      await this.loadAppliedMigrations();

      this.logger.info({ module: 'MigrationManager', method: 'initialize' }, 
        'Migration system initialized');
    } catch (error) {
      this.logger.error({ module: 'MigrationManager', method: 'initialize' }, 
        'Failed to initialize migration system', error);
      throw new MigrationError(`Failed to initialize migration system: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Загрузка информации о примененных миграциях
   */
  private async loadAppliedMigrations(): Promise<void> {
    try {
      const result = await this.queryEngine.query(`
        SELECT version FROM _migrations WHERE applied_at != NONE AND rolled_back_at = NONE;
      `);

      this.appliedMigrations.clear();
      for (const record of result.data || []) {
        this.appliedMigrations.add(record.version);
      }

      this.logger.debug({ module: 'MigrationManager', method: 'loadAppliedMigrations' }, 
        `Loaded ${this.appliedMigrations.size} applied migrations`);
    } catch (error) {
      this.logger.warn({ module: 'MigrationManager', method: 'loadAppliedMigrations' }, 
        'Failed to load applied migrations', error);
    }
  }

  /**
   * Получение статуса миграций
   */
  async getStatus(): Promise<MigrationStatus[]> {
    const statuses: MigrationStatus[] = [];
    
    for (const [version, migration] of this.migrations) {
      const applied = this.appliedMigrations.has(version);
      
      let appliedAt: string | undefined;
      let rolledBackAt: string | undefined;
      let error: string | undefined;

      if (applied) {
        try {
          const result = await this.queryEngine.query(`
            SELECT applied_at, rolled_back_at FROM _migrations WHERE version = $version;
          `, { version });

          const record = result.data?.[0];
          if (record) {
            appliedAt = record.applied_at;
            rolledBackAt = record.rolled_back_at;
          }
        } catch (err) {
          error = err instanceof Error ? err.message : 'Unknown error';
        }
      }

      statuses.push({
        version,
        name: migration.name,
        applied,
        appliedAt,
        rolledBackAt,
        error
      });
    }

    return statuses.sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Создание плана миграции
   */
  createPlan(targetVersion?: string): MigrationPlan {
    const toApply: Migration[] = [];
    const toRollback: Migration[] = [];
    const conflicts: string[] = [];

    // Определение миграций для применения
    if (targetVersion) {
      const targetMigration = this.migrations.get(targetVersion);
      if (!targetMigration) {
        throw new MigrationError(`Target migration ${targetVersion} not found`);
      }

      // Поиск пути к целевой миграции
      const path = this.findMigrationPath(targetVersion);
      for (const version of path) {
        if (!this.appliedMigrations.has(version)) {
          const migration = this.migrations.get(version);
          if (migration) {
            toApply.push(migration);
          }
        }
      }
    } else {
      // Применение всех непримененных миграций
      for (const [version, migration] of this.migrations) {
        if (!this.appliedMigrations.has(version)) {
          toApply.push(migration);
        }
      }
    }

    // Проверка зависимостей
    for (const migration of toApply) {
      if (migration.dependencies) {
        for (const dep of migration.dependencies) {
          if (!this.appliedMigrations.has(dep) && !toApply.find(m => m.version === dep)) {
            conflicts.push(`Migration ${migration.version} depends on ${dep} which is not applied`);
          }
        }
      }
    }

    // Оценка времени выполнения
    const estimatedTime = toApply.length * 1000; // 1 секунда на миграцию

    return {
      toApply,
      toRollback,
      conflicts,
      estimatedTime
    };
  }

  /**
   * Поиск пути миграции
   */
  private findMigrationPath(targetVersion: string): string[] {
    const path: string[] = [];
    const visited = new Set<string>();

    const dfs = (version: string): boolean => {
      if (visited.has(version)) {
        return false; // Циклическая зависимость
      }

      visited.add(version);

      if (version === targetVersion) {
        path.push(version);
        return true;
      }

      const migration = this.migrations.get(version);
      if (migration && migration.dependencies) {
        for (const dep of migration.dependencies) {
          if (dfs(dep)) {
            path.push(version);
            return true;
          }
        }
      }

      return false;
    };

    // Поиск от всех непримененных миграций
    for (const [version] of this.migrations) {
      if (!this.appliedMigrations.has(version)) {
        if (dfs(version)) {
          break;
        }
      }
    }

    return path.reverse();
  }

  /**
   * Применение миграций
   */
  async migrate(targetVersion?: string): Promise<void> {
    const plan = this.createPlan(targetVersion);

    if (plan.conflicts.length > 0) {
      throw new MigrationError(`Migration conflicts: ${plan.conflicts.join(', ')}`);
    }

    this.logger.info({ module: 'MigrationManager', method: 'migrate' }, 
      `Starting migration of ${plan.toApply.length} migrations`);

    for (const migration of plan.toApply) {
      try {
        await this.applyMigration(migration);
        this.logger.info({ module: 'MigrationManager', method: 'migrate' }, 
          `Migration applied: ${migration.version} - ${migration.name}`);
      } catch (error) {
        this.logger.error({ module: 'MigrationManager', method: 'migrate' }, 
          `Failed to apply migration ${migration.version}`, error);
        throw new MigrationError(`Failed to apply migration ${migration.version}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    this.logger.info({ module: 'MigrationManager', method: 'migrate' }, 
      'Migration completed successfully');
  }

  /**
   * Применение отдельной миграции
   */
  private async applyMigration(migration: Migration): Promise<void> {
    // Выполнение миграции
    await migration.up(this.queryEngine);

    // Запись в таблицу миграций
    await this.queryEngine.query(`
      CREATE _migrations:${migration.version} CONTENT {
        version: $version,
        name: $name,
        applied_at: time::now()
      };
    `, {
      version: migration.version,
      name: migration.name
    });

    this.appliedMigrations.add(migration.version);
  }

  /**
   * Откат миграции
   */
  async rollback(targetVersion?: string): Promise<void> {
    const migrationsToRollback = this.getMigrationsToRollback(targetVersion);

    this.logger.info({ module: 'MigrationManager', method: 'rollback' }, 
      `Starting rollback of ${migrationsToRollback.length} migrations`);

    for (const migration of migrationsToRollback) {
      try {
        await this.rollbackMigration(migration);
        this.logger.info({ module: 'MigrationManager', method: 'rollback' }, 
          `Migration rolled back: ${migration.version} - ${migration.name}`);
      } catch (error) {
        this.logger.error({ module: 'MigrationManager', method: 'rollback' }, 
          `Failed to rollback migration ${migration.version}`, error);
        throw new MigrationError(`Failed to rollback migration ${migration.version}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    this.logger.info({ module: 'MigrationManager', method: 'rollback' }, 
      'Rollback completed successfully');
  }

  /**
   * Получение миграций для отката
   */
  private getMigrationsToRollback(targetVersion?: string): Migration[] {
    const toRollback: Migration[] = [];
    const appliedVersions = Array.from(this.appliedMigrations).sort().reverse();

    for (const version of appliedVersions) {
      if (targetVersion && version === targetVersion) {
        break;
      }

      const migration = this.migrations.get(version);
      if (migration && migration.rollbackable !== false) {
        toRollback.push(migration);
      }
    }

    return toRollback;
  }

  /**
   * Откат отдельной миграции
   */
  private async rollbackMigration(migration: Migration): Promise<void> {
    // Выполнение отката
    await migration.down(this.queryEngine);

    // Обновление записи в таблице миграций
    await this.queryEngine.query(`
      UPDATE _migrations:${migration.version} SET rolled_back_at = time::now();
    `);

    this.appliedMigrations.delete(migration.version);
  }

  /**
   * Создание новой миграции
   */
  createMigration(name: string, description?: string): Migration {
    const version = this.generateVersion();
    
    const migration: Migration = {
      version,
      name,
      description,
      up: async () => {
        throw new MigrationError('Migration up method not implemented');
      },
      down: async () => {
        throw new MigrationError('Migration down method not implemented');
      },
      rollbackable: true
    };

    return migration;
  }

  /**
   * Генерация версии миграции
   */
  private generateVersion(): string {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0');
    
    return timestamp;
  }

  /**
   * Получение информации о миграциях
   */
  getMigrations(): Migration[] {
    return Array.from(this.migrations.values()).sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Проверка, применена ли миграция
   */
  isApplied(version: string): boolean {
    return this.appliedMigrations.has(version);
  }
}

// Экспорт
export {
  Migration,
  MigrationStatus,
  MigrationPlan,
  MigrationManager
};