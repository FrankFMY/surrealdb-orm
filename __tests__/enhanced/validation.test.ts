/**
 * Тесты для системы валидации
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaValidator, type StrictDatabaseSchema } from '../../src/types/validation.js';

describe('SchemaValidator', () => {
  let validator: SchemaValidator;
  let schema: StrictDatabaseSchema;

  beforeEach(() => {
    schema = {
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
          },
          tags: {
            type: 'array',
            arrayOf: 'string',
            required: false,
            constraints: {
              maxItems: 10,
              uniqueItems: true
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
      }
    };

    validator = new SchemaValidator(schema);
  });

  describe('validateSchema', () => {
    it('should validate correct schema', () => {
      const result = validator.validateSchema();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing fields in table', () => {
      const invalidSchema = {
        users: {
          fields: {}
        }
      } as StrictDatabaseSchema;

      const invalidValidator = new SchemaValidator(invalidSchema);
      const result = invalidValidator.validateSchema();
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'EMPTY_FIELDS')).toBe(true);
    });

    it('should detect invalid index fields', () => {
      const invalidSchema = {
        users: {
          fields: {
            email: { type: 'string' }
          },
          indexes: [
            {
              name: 'idx_invalid',
              fields: ['nonexistent_field'],
              unique: true
            }
          ]
        }
      } as StrictDatabaseSchema;

      const invalidValidator = new SchemaValidator(invalidSchema);
      const result = invalidValidator.validateSchema();
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_INDEX_FIELD')).toBe(true);
    });
  });

  describe('validateRecord', () => {
    it('should validate correct record data', () => {
      const data = {
        email: 'test@example.com',
        age: 25,
        profile: {
          bio: 'Test bio'
        },
        tags: ['tag1', 'tag2']
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitizedData).toEqual(data);
    });

    it('should detect validation errors', () => {
      const data = {
        email: 'invalid-email',
        age: -5,
        tags: ['tag1', 'tag1'] // duplicate tags
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.code === 'INVALID_EMAIL')).toBe(true);
      expect(result.errors.some(e => e.code === 'MIN_VALUE_VIOLATION')).toBe(true);
      expect(result.errors.some(e => e.code === 'UNIQUE_ITEMS_VIOLATION')).toBe(true);
    });

    it('should detect missing required fields', () => {
      const data = {
        age: 25
        // email is missing
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should sanitize data types', () => {
      const data = {
        email: 'test@example.com',
        age: '25', // string instead of number
        tags: 'tag1,tag2' // string instead of array
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(true);
      expect(result.sanitizedData.age).toBe(25);
      expect(Array.isArray(result.sanitizedData.tags)).toBe(true);
    });

    it('should handle unknown fields when allowUnknownFields is false', () => {
      const data = {
        email: 'test@example.com',
        unknownField: 'value'
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'UNKNOWN_FIELD')).toBe(true);
    });
  });

  describe('field validation', () => {
    it('should validate string constraints', () => {
      const data = {
        email: 'a@b.c' // too short
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MIN_LENGTH_VIOLATION')).toBe(true);
    });

    it('should validate number constraints', () => {
      const data = {
        email: 'test@example.com',
        age: 200 // too high
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MAX_VALUE_VIOLATION')).toBe(true);
    });

    it('should validate array constraints', () => {
      const data = {
        email: 'test@example.com',
        tags: Array.from({ length: 15 }, (_, i) => `tag${i}`) // too many items
      };

      const result = validator.validateRecord('users', data, {
        tableName: 'users',
        operation: 'create'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MAX_ITEMS_VIOLATION')).toBe(true);
    });
  });
});