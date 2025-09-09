/**
 * Расширенные примеры использования улучшенного SurrealDB ORM
 */

import { 
  ConnectionManager, 
  QueryEngine, 
  createEnhancedORM,
  type EnhancedORMConfig 
} from '../src/orm-enhanced.js';
import { ConnectionPool } from '../src/performance/connection-pool.js';
import { MigrationManager } from '../src/migrations/migration-manager.js';
import { MetricsCollector } from '../src/monitoring/metrics-collector.js';
import { SimpleLogger, SimpleFuture } from '../src/helpers.js';
import type { StrictDatabaseSchema } from '../src/types/validation.js';

// Расширенная схема с валидацией
const enhancedSchema: StrictDatabaseSchema = {
  users: {
    comment: 'Пользователи системы',
    fields: {
      email: {
        type: 'string',
        required: true,
        constraints: {
          email: true,
          minLength: 5,
          maxLength: 100
        },
        comment: 'Email пользователя'
      },
      username: {
        type: 'string',
        required: true,
        constraints: {
          minLength: 3,
          maxLength: 50,
          pattern: /^[a-zA-Z0-9_]+$/
        },
        comment: 'Имя пользователя'
      },
      age: {
        type: 'number',
        required: false,
        constraints: {
          min: 0,
          max: 150,
          integer: true
        },
        comment: 'Возраст пользователя'
      },
      profile: {
        type: 'object',
        required: false,
        properties: {
          bio: { 
            type: 'string',
            constraints: { maxLength: 500 }
          },
          avatar: { 
            type: 'string',
            constraints: { url: true }
          },
          preferences: {
            type: 'object',
            properties: {
              theme: {
                type: 'string',
                literals: ['light', 'dark', 'auto']
              },
              language: {
                type: 'string',
                constraints: { minLength: 2, maxLength: 5 }
              }
            }
          }
        }
      },
      tags: {
        type: 'array',
        arrayOf: 'string',
        required: false,
        constraints: {
          maxItems: 10,
          uniqueItems: true
        }
      },
      status: {
        type: 'string',
        required: true,
        default: 'active',
        literals: ['active', 'inactive', 'suspended', 'banned']
      },
      createdAt: {
        type: 'datetime',
        required: true,
        readonly: true,
        valueExpr: 'time::now()'
      },
      updatedAt: {
        type: 'datetime',
        required: true,
        readonly: true,
        valueExpr: 'time::now()'
      }
    },
    indexes: [
      {
        name: 'idx_email',
        fields: ['email'],
        unique: true
      },
      {
        name: 'idx_username',
        fields: ['username'],
        unique: true
      },
      {
        name: 'idx_status_created',
        fields: ['status', 'createdAt']
      },
      {
        name: 'search_profile',
        fields: ['profile.bio'],
        search: {
          analyzer: 'english',
          bm25: { k1: 1.2, b: 0.75 },
          highlights: true
        }
      }
    ],
    constraints: [
      {
        name: 'check_username_format',
        expression: 'string::matches($value.username, "^[a-zA-Z0-9_]+$")'
      }
    ],
    permissions: {
      select: 'status != "banned"',
      create: 'true',
      update: 'id = $auth.id OR $auth.role = "admin"',
      delete: '$auth.role = "admin"'
    }
  },

  posts: {
    comment: 'Посты пользователей',
    fields: {
      title: {
        type: 'string',
        required: true,
        constraints: {
          minLength: 1,
          maxLength: 200
        }
      },
      content: {
        type: 'string',
        required: true,
        constraints: {
          minLength: 10,
          maxLength: 10000
        }
      },
      author: {
        type: 'record',
        required: true,
        references: 'users'
      },
      published: {
        type: 'boolean',
        required: true,
        default: false
      },
      publishedAt: {
        type: 'datetime',
        required: false
      },
      tags: {
        type: 'array',
        arrayOf: 'string',
        required: false,
        constraints: {
          maxItems: 20,
          uniqueItems: true
        }
      },
      metadata: {
        type: 'object',
        required: false,
        properties: {
          views: { type: 'number', default: 0 },
          likes: { type: 'number', default: 0 },
          shares: { type: 'number', default: 0 }
        }
      }
    },
    indexes: [
      {
        name: 'idx_author_published',
        fields: ['author', 'published']
      },
      {
        name: 'idx_published_at',
        fields: ['publishedAt']
      },
      {
        name: 'search_content',
        fields: ['title', 'content'],
        search: {
          analyzer: 'english',
          bm25: { k1: 1.2, b: 0.75 },
          highlights: true
        }
      }
    ],
    triggers: [
      {
        name: 'set_published_at',
        event: 'UPDATE',
        expression: 'IF $value.published = true AND $before.published = false THEN $value.publishedAt = time::now() END'
      }
    ]
  },

  comments: {
    comment: 'Комментарии к постам',
    fields: {
      content: {
        type: 'string',
        required: true,
        constraints: {
          minLength: 1,
          maxLength: 1000
        }
      },
      post: {
        type: 'record',
        required: true,
        references: 'posts'
      },
      author: {
        type: 'record',
        required: true,
        references: 'users'
      },
      parent: {
        type: 'record',
        required: false,
        references: 'comments'
      },
      likes: {
        type: 'number',
        required: true,
        default: 0,
        constraints: {
          min: 0
        }
      }
    },
    indexes: [
      {
        name: 'idx_post_created',
        fields: ['post', 'createdAt']
      },
      {
        name: 'idx_author',
        fields: ['author']
      },
      {
        name: 'idx_parent',
        fields: ['parent']
      }
    ]
  }
};

// Пример 1: Базовое использование с валидацией
export async function basicUsageExample() {
  console.log('🚀 Пример базового использования с валидацией');

  const connection = new ConnectionManager(
    {
      rpc: 'ws://localhost:3603/rpc',
      namespace: 'test',
      database: 'test_db',
      user: 'root',
      pass: 'password'
    },
    new SimpleLogger(),
    new SimpleFuture()
  );

  await connection.connect();

  const queryEngine = new QueryEngine(connection, new SimpleLogger(), {
    enableCaching: true,
    enableQueryLogging: true
  });

  const orm = createEnhancedORM(connection, queryEngine, enhancedSchema, {
    enableValidation: true,
    enableCaching: true,
    enableAudit: true,
    strictMode: true
  });

  await orm.sync();

  const usersTable = orm.table('users');

  try {
    // Создание пользователя с валидацией
    const user = await usersTable.createRecord({
      email: 'john.doe@example.com',
      username: 'johndoe',
      age: 25,
      profile: {
        bio: 'Software developer passionate about TypeScript',
        avatar: 'https://example.com/avatar.jpg',
        preferences: {
          theme: 'dark',
          language: 'en'
        }
      },
      tags: ['developer', 'typescript', 'nodejs']
    });

    console.log('✅ Пользователь создан:', user);

    // Попытка создать пользователя с невалидными данными
    try {
      await usersTable.createRecord({
        email: 'invalid-email',
        username: 'invalid username!',
        age: -5
      });
    } catch (error) {
      console.log('❌ Валидация сработала:', error.message);
    }

  } catch (error) {
    console.error('Ошибка:', error);
  } finally {
    await connection.disconnect();
  }
}

// Пример 2: Использование с Connection Pool
export async function connectionPoolExample() {
  console.log('🏊 Пример использования Connection Pool');

  const pool = new ConnectionPool(
    {
      rpc: 'ws://localhost:3603/rpc',
      namespace: 'test',
      database: 'test_db',
      user: 'root',
      pass: 'password',
      minConnections: 2,
      maxConnections: 5
    },
    new SimpleLogger(),
    new SimpleFuture()
  );

  await pool.initialize();

  const queryEngine = new QueryEngine(pool.getConnection(), new SimpleLogger());
  const orm = createEnhancedORM(pool.getConnection(), queryEngine, enhancedSchema);

  await orm.sync();

  // Параллельные операции
  const promises = Array.from({ length: 10 }, async (_, i) => {
    const connection = pool.getConnection();
    const table = orm.table('users');
    
    return table.createRecord({
      email: `user${i}@example.com`,
      username: `user${i}`,
      age: 20 + i
    });
  });

  const users = await Promise.all(promises);
  console.log(`✅ Создано ${users.length} пользователей параллельно`);

  // Статистика пула
  const stats = pool.getStats();
  console.log('📊 Статистика пула:', stats);

  await pool.close();
}

// Пример 3: Система миграций
export async function migrationsExample() {
  console.log('🔄 Пример системы миграций');

  const connection = new ConnectionManager(
    {
      rpc: 'ws://localhost:3603/rpc',
      namespace: 'test',
      database: 'test_db',
      user: 'root',
      pass: 'password'
    },
    new SimpleLogger(),
    new SimpleFuture()
  );

  await connection.connect();

  const queryEngine = new QueryEngine(connection, new SimpleLogger());
  const migrationManager = new MigrationManager(queryEngine, new SimpleLogger());

  await migrationManager.initialize();

  // Регистрация миграций
  migrationManager.registerMigration({
    version: '20240101000001',
    name: 'create_users_table',
    description: 'Создание таблицы пользователей',
    up: async (queryEngine) => {
      await queryEngine.query(`
        DEFINE TABLE users SCHEMALESS;
        DEFINE FIELD email ON TABLE users TYPE string ASSERT string::is::email($value);
        DEFINE FIELD username ON TABLE users TYPE string ASSERT string::len($value) >= 3;
        DEFINE INDEX idx_email ON TABLE users FIELDS email UNIQUE;
      `);
    },
    down: async (queryEngine) => {
      await queryEngine.query('REMOVE TABLE users;');
    },
    rollbackable: true
  });

  migrationManager.registerMigration({
    version: '20240101000002',
    name: 'create_posts_table',
    description: 'Создание таблицы постов',
    dependencies: ['20240101000001'],
    up: async (queryEngine) => {
      await queryEngine.query(`
        DEFINE TABLE posts SCHEMALESS;
        DEFINE FIELD title ON TABLE posts TYPE string ASSERT string::len($value) >= 1;
        DEFINE FIELD author ON TABLE posts TYPE record<users>;
        DEFINE INDEX idx_author ON TABLE posts FIELDS author;
      `);
    },
    down: async (queryEngine) => {
      await queryEngine.query('REMOVE TABLE posts;');
    },
    rollbackable: true
  });

  // Применение миграций
  await migrationManager.migrate();

  // Проверка статуса
  const status = await migrationManager.getStatus();
  console.log('📋 Статус миграций:', status);

  await connection.disconnect();
}

// Пример 4: Мониторинг и метрики
export async function monitoringExample() {
  console.log('📊 Пример мониторинга и метрик');

  const metrics = new MetricsCollector({
    collectionInterval: 10000,
    retentionPeriod: 300000
  }, new SimpleLogger());

  // Установка пороговых значений
  metrics.setThreshold('query_duration', 1000, '>');
  metrics.setThreshold('error_rate', 0.1, '>');

  // Обработчики событий
  metrics.on('threshold', (metric, threshold) => {
    console.warn(`⚠️ Порог превышен: ${metric.name} = ${metric.value} (порог: ${threshold})`);
  });

  metrics.on('aggregation', (aggregated) => {
    console.log(`📈 Агрегированные метрики для ${aggregated.name}:`, {
      count: aggregated.count,
      avg: aggregated.avg,
      p95: aggregated.p95
    });
  });

  // Симуляция работы
  for (let i = 0; i < 100; i++) {
    metrics.increment('queries_total');
    metrics.timer('query_duration', Math.random() * 2000);
    metrics.gauge('active_connections', Math.floor(Math.random() * 10));
    
    if (Math.random() < 0.1) {
      metrics.increment('errors_total', 1, { type: 'validation' });
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Получение статистики
  const stats = metrics.getStats();
  console.log('📊 Статистика метрик:', stats);

  // Получение агрегированных метрик
  const queryMetrics = metrics.getAggregatedMetrics('query_duration', '1m');
  console.log('📈 Метрики запросов:', queryMetrics);

  metrics.stop();
}

// Пример 5: Полный пример с всеми возможностями
export async function fullExample() {
  console.log('🌟 Полный пример с всеми возможностями');

  // Инициализация компонентов
  const logger = new SimpleLogger();
  const future = new SimpleFuture();
  
  const pool = new ConnectionPool(
    {
      rpc: 'ws://localhost:3603/rpc',
      namespace: 'blog',
      database: 'blog_db',
      user: 'root',
      pass: 'password',
      minConnections: 3,
      maxConnections: 10
    },
    logger,
    future
  );

  await pool.initialize();

  const queryEngine = new QueryEngine(pool.getConnection(), logger, {
    enableCaching: true,
    cacheTTL: 300000,
    enableQueryLogging: true,
    rateLimit: {
      requestsPerSecond: 100,
      burstLimit: 10
    }
  });

  const metrics = new MetricsCollector({
    collectionInterval: 30000,
    retentionPeriod: 1800000
  }, logger);

  const orm = createEnhancedORM(pool.getConnection(), queryEngine, enhancedSchema, {
    enableValidation: true,
    enableCaching: true,
    enableAudit: true,
    enableRateLimit: true,
    strictMode: true,
    cacheConfig: {
      defaultTTL: 300000,
      maxSize: 1000
    },
    rateLimitConfig: {
      requestsPerSecond: 100,
      burstLimit: 10
    },
    auditConfig: {
      logAllOperations: true,
      sensitiveFields: ['password', 'token']
    }
  });

  try {
    // Синхронизация схемы
    await orm.sync();

    const usersTable = orm.table('users');
    const postsTable = orm.table('posts');
    const commentsTable = orm.table('comments');

    // Создание пользователя
    const user = await usersTable.createRecord({
      email: 'author@example.com',
      username: 'author',
      age: 30,
      profile: {
        bio: 'Blog author and developer',
        avatar: 'https://example.com/author.jpg',
        preferences: {
          theme: 'light',
          language: 'en'
        }
      },
      tags: ['author', 'developer', 'blogger']
    });

    console.log('✅ Пользователь создан:', user.username);

    // Создание поста
    const post = await postsTable.createRecord({
      title: 'Getting Started with SurrealDB ORM',
      content: 'This is a comprehensive guide to using the enhanced SurrealDB ORM with TypeScript...',
      author: user.id,
      published: true,
      tags: ['surrealdb', 'orm', 'typescript', 'tutorial']
    });

    console.log('✅ Пост создан:', post.title);

    // Создание комментария
    const comment = await commentsTable.createRecord({
      content: 'Great tutorial! Very helpful for beginners.',
      post: post.id,
      author: user.id
    });

    console.log('✅ Комментарий создан');

    // Поиск с кэшированием
    const publishedPosts = await postsTable.find('published = $published', {
      published: true
    });

    console.log(`📝 Найдено ${publishedPosts.length} опубликованных постов`);

    // Получение статистики
    const ormStats = orm.getStats();
    const queryStats = queryEngine.getPerformanceStats();
    const poolStats = pool.getStats();
    const metricsStats = metrics.getStats();

    console.log('📊 Статистика системы:', {
      orm: ormStats,
      queries: queryStats,
      pool: poolStats,
      metrics: metricsStats
    });

  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    metrics.stop();
    await pool.close();
  }
}

// Запуск примеров
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🎯 Запуск примеров SurrealDB ORM Enhanced\n');

  try {
    await basicUsageExample();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await connectionPoolExample();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await migrationsExample();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await monitoringExample();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await fullExample();
    
    console.log('\n🎉 Все примеры выполнены успешно!');
  } catch (error) {
    console.error('❌ Ошибка при выполнении примеров:', error);
    process.exit(1);
  }
}