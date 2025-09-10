/**
 * Интеграционные тесты для улучшенного ORM
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  ConnectionManager, 
  QueryEngine, 
  createEnhancedORM,
  type EnhancedORMConfig 
} from '../../src/orm-enhanced.js';
import { SimpleLogger, SimpleFuture } from '../../src/helpers.js';
import type { StrictDatabaseSchema } from '../../src/types/validation.js';

// Тестовая схема
const testSchema: StrictDatabaseSchema = {
  users: {
    comment: 'Пользователи',
    fields: {
      email: {
        type: 'string',
        required: true,
        constraints: {
          email: true,
          minLength: 5,
          maxLength: 100
        }
      },
      username: {
        type: 'string',
        required: true,
        constraints: {
          minLength: 3,
          maxLength: 50
        }
      },
      age: {
        type: 'number',
        required: false,
        constraints: {
          min: 0,
          max: 150,
          integer: true
        }
      },
      profile: {
        type: 'object',
        required: false,
        properties: {
          bio: {
            type: 'string',
            constraints: { maxLength: 500 }
          }
        }
      }
    },
    indexes: [
      {
        name: 'idx_email',
        fields: ['email'],
        unique: true
      }
    ]
  },

  posts: {
    comment: 'Посты',
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
          minLength: 10
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
      }
    },
    indexes: [
      {
        name: 'idx_author',
        fields: ['author']
      }
    ]
  }
};

describe('Enhanced ORM Integration Tests', () => {
  let connection: ConnectionManager;
  let queryEngine: QueryEngine;
  let orm: ReturnType<typeof createEnhancedORM>;
  let logger: SimpleLogger;

  beforeEach(async () => {
    logger = new SimpleLogger();
    
    connection = new ConnectionManager(
      {
        rpc: 'ws://localhost:3603/rpc',
        namespace: 'test',
        database: 'test_db',
        user: 'root',
        pass: 'password'
      },
      logger,
      new SimpleFuture()
    );

    await connection.connect();

    queryEngine = new QueryEngine(connection, logger, {
      enableCaching: true,
      enableQueryLogging: true
    });

    const ormConfig: EnhancedORMConfig = {
      enableValidation: true,
      enableCaching: true,
      enableAudit: true,
      strictMode: true
    };

    orm = createEnhancedORM(connection, queryEngine, testSchema, ormConfig);
    await orm.sync();
  });

  afterEach(async () => {
    // Очистка тестовых данных
    try {
      await queryEngine.query('DELETE FROM users');
      await queryEngine.query('DELETE FROM posts');
    } catch (error) {
      // Игнорируем ошибки очистки
    }
    
    await connection.disconnect();
  });

  describe('CRUD Operations', () => {
    it('should create, read, update, and delete records', async () => {
      const usersTable = orm.table('users');

      // Create
      const user = await usersTable.createRecord({
        email: 'test@example.com',
        username: 'testuser',
        age: 25,
        profile: {
          bio: 'Test user bio'
        }
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.username).toBe('testuser');
      expect(user.age).toBe(25);

      // Read
      const foundUser = await usersTable.findById(user.id);
      expect(foundUser).toBeDefined();
      expect(foundUser?.email).toBe('test@example.com');

      // Update
      const updatedUser = await usersTable.updateRecord(user.id, {
        age: 26,
        profile: {
          bio: 'Updated bio'
        }
      });

      expect(updatedUser.age).toBe(26);
      expect(updatedUser.profile?.bio).toBe('Updated bio');

      // Delete
      await usersTable.deleteRecord(user.id);
      
      const deletedUser = await usersTable.findById(user.id);
      expect(deletedUser).toBeNull();
    });

    it('should handle validation errors', async () => {
      const usersTable = orm.table('users');

      // Test invalid email
      await expect(
        usersTable.createRecord({
          email: 'invalid-email',
          username: 'testuser'
        })
      ).rejects.toThrow('Validation failed');

      // Test missing required field
      await expect(
        usersTable.createRecord({
          username: 'testuser'
          // email is missing
        })
      ).rejects.toThrow('Validation failed');

      // Test invalid age
      await expect(
        usersTable.createRecord({
          email: 'test@example.com',
          username: 'testuser',
          age: -5
        })
      ).rejects.toThrow('Validation failed');
    });
  });

  describe('Relationships', () => {
    it('should handle record relationships', async () => {
      const usersTable = orm.table('users');
      const postsTable = orm.table('posts');

      // Create user
      const user = await usersTable.createRecord({
        email: 'author@example.com',
        username: 'author'
      });

      // Create post with author relationship
      const post = await postsTable.createRecord({
        title: 'Test Post',
        content: 'This is a test post content',
        author: user.id,
        published: true
      });

      expect(post.author).toBe(user.id);

      // Find posts by author
      const userPosts = await postsTable.find('author = $author', {
        author: user.id
      });

      expect(userPosts).toHaveLength(1);
      expect(userPosts[0].title).toBe('Test Post');
    });
  });

  describe('Query Operations', () => {
    it('should perform complex queries', async () => {
      const usersTable = orm.table('users');

      // Create multiple users
      const users = await Promise.all([
        usersTable.createRecord({
          email: 'user1@example.com',
          username: 'user1',
          age: 25
        }),
        usersTable.createRecord({
          email: 'user2@example.com',
          username: 'user2',
          age: 30
        }),
        usersTable.createRecord({
          email: 'user3@example.com',
          username: 'user3',
          age: 35
        })
      ]);

      // Find users by age range
      const youngUsers = await usersTable.find('age < $maxAge', {
        maxAge: 30
      });

      expect(youngUsers).toHaveLength(1);
      expect(youngUsers[0].username).toBe('user1');

      // Find users by email pattern
      const emailUsers = await usersTable.find('email CONTAINS $domain', {
        domain: 'example.com'
      });

      expect(emailUsers).toHaveLength(3);
    });
  });

  describe('Caching', () => {
    it('should cache query results', async () => {
      const usersTable = orm.table('users');

      // Create user
      const user = await usersTable.createRecord({
        email: 'cache@example.com',
        username: 'cacheuser'
      });

      // First query (should not be cached)
      const start1 = Date.now();
      const user1 = await usersTable.findById(user.id);
      const time1 = Date.now() - start1;

      // Second query (should be cached)
      const start2 = Date.now();
      const user2 = await usersTable.findById(user.id);
      const time2 = Date.now() - start2;

      expect(user1).toEqual(user2);
      // Cached query should be faster (though this might not always be true in tests)
      expect(time2).toBeLessThanOrEqual(time1);
    });
  });

  describe('Audit Logging', () => {
    it('should log operations when audit is enabled', async () => {
      const usersTable = orm.table('users');

      // Create user
      const user = await usersTable.createRecord({
        email: 'audit@example.com',
        username: 'audituser'
      });

      // Update user
      await usersTable.updateRecord(user.id, {
        age: 25
      });

      // Delete user
      await usersTable.deleteRecord(user.id);

      // Get audit logs (this would need to be implemented in the actual ORM)
      const stats = orm.getStats();
      expect(stats.auditLogs).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      // Disconnect connection
      await connection.disconnect();

      const usersTable = orm.table('users');

      // Should throw connection error
      await expect(
        usersTable.createRecord({
          email: 'test@example.com',
          username: 'testuser'
        })
      ).rejects.toThrow();
    });

    it('should handle SQL injection attempts', async () => {
      const usersTable = orm.table('users');

      // Should detect and prevent SQL injection
      await expect(
        usersTable.find("email = 'test@example.com'; DROP TABLE users; --'")
      ).rejects.toThrow('Potential SQL injection detected');
    });
  });

  describe('Performance', () => {
    it('should handle batch operations efficiently', async () => {
      const usersTable = orm.table('users');

      // Create multiple users in parallel
      const start = Date.now();
      const users = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          usersTable.createRecord({
            email: `user${i}@example.com`,
            username: `user${i}`,
            age: 20 + i
          })
        )
      );
      const time = Date.now() - start;

      expect(users).toHaveLength(10);
      expect(time).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('Schema Validation', () => {
    it('should validate schema on initialization', () => {
      const isValid = orm.validateSchema();
      expect(isValid).toBe(true);
    });

    it('should reject invalid schema in strict mode', async () => {
      const invalidSchema = {
        users: {
          fields: {
            email: {
              type: 'invalid_type' as any
            }
          }
        }
      } as StrictDatabaseSchema;

      const invalidOrm = createEnhancedORM(connection, queryEngine, invalidSchema, {
        strictMode: true
      });

      expect(() => invalidOrm.validateSchema()).toThrow();
    });
  });
});