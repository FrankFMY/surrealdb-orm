/**
 * Тесты для системы ошибок
 */

import { describe, it, expect } from 'vitest';
import {
  SurrealORMError,
  ValidationError,
  ConnectionError,
  QueryError,
  ErrorHandler
} from '../../src/errors/index.js';

describe('Error System', () => {
  describe('SurrealORMError', () => {
    it('should create error with message and context', () => {
      const error = new SurrealORMError('Test error', { table: 'users' }) {
        readonly code = 'TEST_ERROR';
        readonly statusCode = 400;
      };

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.context).toEqual({ table: 'users' });
      expect(error.timestamp).toBeDefined();
    });

    it('should serialize to JSON correctly', () => {
      const error = new SurrealORMError('Test error', { table: 'users' }) {
        readonly code = 'TEST_ERROR';
        readonly statusCode = 400;
      };

      const json = error.toJSON();
      expect(json.name).toBe('SurrealORMError');
      expect(json.message).toBe('Test error');
      expect(json.code).toBe('TEST_ERROR');
      expect(json.statusCode).toBe(400);
      expect(json.context).toEqual({ table: 'users' });
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with validation errors', () => {
      const validationErrors = [
        {
          field: 'email',
          message: 'Invalid email format',
          code: 'INVALID_EMAIL',
          value: 'invalid-email'
        }
      ];

      const error = new ValidationError('Validation failed', validationErrors, { table: 'users' });

      expect(error.message).toBe('Validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.validationErrors).toEqual(validationErrors);
    });

    it('should serialize validation errors to JSON', () => {
      const validationErrors = [
        {
          field: 'email',
          message: 'Invalid email format',
          code: 'INVALID_EMAIL',
          value: 'invalid-email'
        }
      ];

      const error = new ValidationError('Validation failed', validationErrors);
      const json = error.toJSON();

      expect(json.validationErrors).toEqual(validationErrors);
    });
  });

  describe('ConnectionError', () => {
    it('should create connection error', () => {
      const error = new ConnectionError('Connection failed', { host: 'localhost' });

      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.statusCode).toBe(503);
      expect(error.context).toEqual({ host: 'localhost' });
    });
  });

  describe('QueryError', () => {
    it('should create query error with SQL', () => {
      const error = new QueryError('Query failed', 'SELECT * FROM users', { table: 'users' });

      expect(error.message).toBe('Query failed');
      expect(error.code).toBe('QUERY_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.sql).toBe('SELECT * FROM users');
    });

    it('should serialize SQL to JSON', () => {
      const error = new QueryError('Query failed', 'SELECT * FROM users');
      const json = error.toJSON();

      expect(json.sql).toBe('SELECT * FROM users');
    });
  });

  describe('ErrorHandler', () => {
    it('should identify ORM errors', () => {
      const ormError = new ValidationError('Test');
      const regularError = new Error('Test');

      expect(ErrorHandler.isORMError(ormError)).toBe(true);
      expect(ErrorHandler.isORMError(regularError)).toBe(false);
    });

    it('should normalize errors to ORM errors', () => {
      const regularError = new Error('Connection failed');
      const normalized = ErrorHandler.normalizeError(regularError, { table: 'users' });

      expect(ErrorHandler.isORMError(normalized)).toBe(true);
      expect(normalized.message).toBe('Connection failed');
      expect(normalized.context).toEqual({ table: 'users' });
    });

    it('should detect error types by message', () => {
      const connectionError = new Error('Connection timeout');
      const authError = new Error('Authentication failed');
      const queryError = new Error('SQL syntax error');

      const normalizedConnection = ErrorHandler.normalizeError(connectionError);
      const normalizedAuth = ErrorHandler.normalizeError(authError);
      const normalizedQuery = ErrorHandler.normalizeError(queryError);

      expect(normalizedConnection.code).toBe('CONNECTION_ERROR');
      expect(normalizedAuth.code).toBe('AUTHENTICATION_ERROR');
      expect(normalizedQuery.code).toBe('QUERY_ERROR');
    });

    it('should create user-friendly messages', () => {
      const validationError = new ValidationError('Validation failed', []);
      const connectionError = new ConnectionError('Connection failed');
      const authError = new AuthenticationError('Auth failed');

      expect(ErrorHandler.createUserMessage(validationError)).toBe('Данные не прошли валидацию. Проверьте введенные значения.');
      expect(ErrorHandler.createUserMessage(connectionError)).toBe('Ошибка подключения к базе данных. Попробуйте позже.');
      expect(ErrorHandler.createUserMessage(authError)).toBe('Ошибка аутентификации. Проверьте учетные данные.');
    });

    it('should log errors', () => {
      const error = new ValidationError('Test error', []);
      const logger = {
        error: vi.fn()
      };

      ErrorHandler.logError(error, logger as any);

      expect(logger.error).toHaveBeenCalledWith(
        '[VALIDATION_ERROR] Test error',
        expect.objectContaining({
          timestamp: expect.any(String)
        })
      );
    });
  });
});