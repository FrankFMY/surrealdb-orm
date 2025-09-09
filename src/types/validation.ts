/**
 * Система валидации и строгих типов для SurrealDB ORM
 */

import type { FieldConfig, TableConfig, DatabaseSchema } from '../orm.js';

// Базовые типы валидации
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: unknown;
}

// Строгие типы для полей
export type StrictFieldType = 
  | 'string'
  | 'number' 
  | 'boolean'
  | 'datetime'
  | 'object'
  | 'array'
  | 'record'
  | 'geometry'
  | 'duration'
  | 'decimal';

// Валидаторы для каждого типа
export interface FieldValidator<T = unknown> {
  validate(value: T): ValidationResult;
  sanitize(value: unknown): T;
}

// Строгие типы для ограничений
export interface StrictConstraints {
  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  email?: boolean;
  url?: boolean;
  uuid?: boolean;
  
  // Number constraints
  min?: number;
  max?: number;
  integer?: boolean;
  positive?: boolean;
  negative?: boolean;
  
  // Array constraints
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  
  // Object constraints
  requiredProperties?: string[];
  additionalProperties?: boolean;
  
  // Custom constraints
  custom?: (value: unknown) => boolean;
}

// Улучшенная конфигурация поля
export interface StrictFieldConfig extends Omit<FieldConfig, 'type' | 'constraints'> {
  type: StrictFieldType;
  constraints?: StrictConstraints;
  validators?: FieldValidator[];
  transform?: (value: unknown) => unknown;
}

// Улучшенная конфигурация таблицы
export interface StrictTableConfig extends Omit<TableConfig, 'fields'> {
  fields: Record<string, StrictFieldConfig>;
  validation?: {
    strict?: boolean;
    allowUnknownFields?: boolean;
    customValidators?: Record<string, FieldValidator>;
  };
}

// Улучшенная схема базы данных
export interface StrictDatabaseSchema {
  [tableName: string]: StrictTableConfig;
  _meta?: {
    version: string;
    description?: string;
    author?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}

// Результат валидации записи
export interface RecordValidationResult extends ValidationResult {
  sanitizedData: Record<string, unknown>;
  warnings: ValidationError[];
}

// Контекст валидации
export interface ValidationContext {
  tableName: string;
  operation: 'create' | 'update' | 'upsert';
  existingData?: Record<string, unknown>;
  user?: {
    id: string;
    roles: string[];
    permissions: string[];
  };
}

// Валидатор схемы
export class SchemaValidator {
  private schema: StrictDatabaseSchema;
  
  constructor(schema: StrictDatabaseSchema) {
    this.schema = schema;
  }
  
  /**
   * Валидация всей схемы
   */
  validateSchema(): ValidationResult {
    const errors: ValidationError[] = [];
    
    for (const [tableName, tableConfig] of Object.entries(this.schema)) {
      if (tableName.startsWith('_')) continue;
      
      // Валидация конфигурации таблицы
      const tableValidation = this.validateTableConfig(tableName, tableConfig);
      errors.push(...tableValidation.errors);
      
      // Валидация полей
      for (const [fieldName, fieldConfig] of Object.entries(tableConfig.fields)) {
        const fieldValidation = this.validateFieldConfig(tableName, fieldName, fieldConfig);
        errors.push(...fieldValidation.errors);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Валидация конфигурации таблицы
   */
  private validateTableConfig(tableName: string, config: StrictTableConfig): ValidationResult {
    const errors: ValidationError[] = [];
    
    // Проверка обязательных полей
    if (!config.fields || Object.keys(config.fields).length === 0) {
      errors.push({
        field: `${tableName}.fields`,
        message: 'Table must have at least one field',
        code: 'EMPTY_FIELDS'
      });
    }
    
    // Проверка индексов
    if (config.indexes) {
      for (const index of config.indexes) {
        if (!index.name || !index.fields || index.fields.length === 0) {
          errors.push({
            field: `${tableName}.indexes.${index.name || 'unnamed'}`,
            message: 'Index must have name and fields',
            code: 'INVALID_INDEX'
          });
        }
        
        // Проверка существования полей в индексе
        for (const fieldName of index.fields) {
          if (!config.fields[fieldName]) {
            errors.push({
              field: `${tableName}.indexes.${index.name}`,
              message: `Index field '${fieldName}' does not exist in table`,
              code: 'INVALID_INDEX_FIELD'
            });
          }
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Валидация конфигурации поля
   */
  private validateFieldConfig(tableName: string, fieldName: string, config: StrictFieldConfig): ValidationResult {
    const errors: ValidationError[] = [];
    
    // Проверка типа поля
    const validTypes: StrictFieldType[] = [
      'string', 'number', 'boolean', 'datetime', 'object', 
      'array', 'record', 'geometry', 'duration', 'decimal'
    ];
    
    if (!validTypes.includes(config.type)) {
      errors.push({
        field: `${tableName}.${fieldName}.type`,
        message: `Invalid field type: ${config.type}`,
        code: 'INVALID_FIELD_TYPE',
        value: config.type
      });
    }
    
    // Проверка ссылок для record полей
    if (config.type === 'record' && !config.references) {
      errors.push({
        field: `${tableName}.${fieldName}.references`,
        message: 'Record field must have references property',
        code: 'MISSING_REFERENCES'
      });
    }
    
    // Проверка arrayOf для array полей
    if (config.type === 'array' && !config.arrayOf) {
      errors.push({
        field: `${tableName}.${fieldName}.arrayOf`,
        message: 'Array field must have arrayOf property',
        code: 'MISSING_ARRAY_OF'
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Валидация данных записи
   */
  validateRecord(
    tableName: string, 
    data: Record<string, unknown>, 
    context: ValidationContext
  ): RecordValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const sanitizedData: Record<string, unknown> = {};
    
    const tableConfig = this.schema[tableName];
    if (!tableConfig) {
      return {
        isValid: false,
        errors: [{
          field: 'table',
          message: `Table '${tableName}' not found in schema`,
          code: 'TABLE_NOT_FOUND'
        }],
        sanitizedData: {},
        warnings: []
      };
    }
    
    // Валидация полей
    for (const [fieldName, fieldConfig] of Object.entries(tableConfig.fields)) {
      const value = data[fieldName];
      const fieldValidation = this.validateFieldValue(fieldName, value, fieldConfig, context);
      
      if (!fieldValidation.isValid) {
        errors.push(...fieldValidation.errors);
      }
      
      if (fieldValidation.warnings) {
        warnings.push(...fieldValidation.warnings);
      }
      
      // Санитизация значения
      sanitizedData[fieldName] = fieldValidation.sanitizedValue;
    }
    
    // Проверка неизвестных полей
    if (!tableConfig.validation?.allowUnknownFields) {
      for (const fieldName of Object.keys(data)) {
        if (!tableConfig.fields[fieldName]) {
          errors.push({
            field: fieldName,
            message: `Unknown field '${fieldName}' in table '${tableName}'`,
            code: 'UNKNOWN_FIELD'
          });
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sanitizedData,
      warnings
    };
  }
  
  /**
   * Валидация значения поля
   */
  private validateFieldValue(
    fieldName: string,
    value: unknown,
    config: StrictFieldConfig,
    context: ValidationContext
  ): {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
    sanitizedValue: unknown;
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let sanitizedValue = value;
    
    // Проверка обязательности
    if (config.required && (value === undefined || value === null)) {
      errors.push({
        field: fieldName,
        message: `Field '${fieldName}' is required`,
        code: 'REQUIRED_FIELD'
      });
      return { isValid: false, errors, warnings, sanitizedValue };
    }
    
    // Если значение не задано и не обязательно, возвращаем undefined
    if (value === undefined || value === null) {
      return { isValid: true, errors, warnings, sanitizedValue: undefined };
    }
    
    // Валидация типа
    const typeValidation = this.validateFieldType(fieldName, value, config.type);
    if (!typeValidation.isValid) {
      errors.push(...typeValidation.errors);
      return { isValid: false, errors, warnings, sanitizedValue };
    }
    
    sanitizedValue = typeValidation.sanitizedValue;
    
    // Валидация ограничений
    if (config.constraints) {
      const constraintsValidation = this.validateConstraints(fieldName, sanitizedValue, config.constraints);
      if (!constraintsValidation.isValid) {
        errors.push(...constraintsValidation.errors);
      }
    }
    
    // Применение трансформации
    if (config.transform) {
      try {
        sanitizedValue = config.transform(sanitizedValue);
      } catch (error) {
        errors.push({
          field: fieldName,
          message: `Transform failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          code: 'TRANSFORM_ERROR'
        });
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }
  
  /**
   * Валидация типа поля
   */
  private validateFieldType(
    fieldName: string,
    value: unknown,
    expectedType: StrictFieldType
  ): {
    isValid: boolean;
    errors: ValidationError[];
    sanitizedValue: unknown;
  } {
    const errors: ValidationError[] = [];
    let sanitizedValue = value;
    
    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          if (typeof value === 'number' || typeof value === 'boolean') {
            sanitizedValue = String(value);
          } else {
            errors.push({
              field: fieldName,
              message: `Expected string, got ${typeof value}`,
              code: 'TYPE_MISMATCH',
              value
            });
          }
        }
        break;
        
      case 'number':
        if (typeof value !== 'number') {
          const parsed = Number(value);
          if (!isNaN(parsed)) {
            sanitizedValue = parsed;
          } else {
            errors.push({
              field: fieldName,
              message: `Expected number, got ${typeof value}`,
              code: 'TYPE_MISMATCH',
              value
            });
          }
        }
        break;
        
      case 'boolean':
        if (typeof value !== 'boolean') {
          if (value === 'true' || value === 'false') {
            sanitizedValue = value === 'true';
          } else if (value === 1 || value === 0) {
            sanitizedValue = Boolean(value);
          } else {
            errors.push({
              field: fieldName,
              message: `Expected boolean, got ${typeof value}`,
              code: 'TYPE_MISMATCH',
              value
            });
          }
        }
        break;
        
      case 'datetime':
        if (typeof value !== 'string') {
          errors.push({
            field: fieldName,
            message: `Expected datetime string, got ${typeof value}`,
            code: 'TYPE_MISMATCH',
            value
          });
        } else {
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            errors.push({
              field: fieldName,
              message: `Invalid datetime format: ${value}`,
              code: 'INVALID_DATETIME',
              value
            });
          }
        }
        break;
        
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          errors.push({
            field: fieldName,
            message: `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}`,
            code: 'TYPE_MISMATCH',
            value
          });
        }
        break;
        
      case 'array':
        if (!Array.isArray(value)) {
          errors.push({
            field: fieldName,
            message: `Expected array, got ${typeof value}`,
            code: 'TYPE_MISMATCH',
            value
          });
        }
        break;
        
      case 'record':
        if (typeof value !== 'string') {
          errors.push({
            field: fieldName,
            message: `Expected record ID string, got ${typeof value}`,
            code: 'TYPE_MISMATCH',
            value
          });
        }
        break;
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue
    };
  }
  
  /**
   * Валидация ограничений
   */
  private validateConstraints(
    fieldName: string,
    value: unknown,
    constraints: StrictConstraints
  ): ValidationResult {
    const errors: ValidationError[] = [];
    
    // String constraints
    if (typeof value === 'string') {
      if (constraints.minLength !== undefined && value.length < constraints.minLength) {
        errors.push({
          field: fieldName,
          message: `String length must be at least ${constraints.minLength}`,
          code: 'MIN_LENGTH_VIOLATION',
          value
        });
      }
      
      if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
        errors.push({
          field: fieldName,
          message: `String length must be at most ${constraints.maxLength}`,
          code: 'MAX_LENGTH_VIOLATION',
          value
        });
      }
      
      if (constraints.pattern && !constraints.pattern.test(value)) {
        errors.push({
          field: fieldName,
          message: `String does not match required pattern`,
          code: 'PATTERN_VIOLATION',
          value
        });
      }
      
      if (constraints.email && !this.isValidEmail(value)) {
        errors.push({
          field: fieldName,
          message: `Invalid email format`,
          code: 'INVALID_EMAIL',
          value
        });
      }
      
      if (constraints.url && !this.isValidUrl(value)) {
        errors.push({
          field: fieldName,
          message: `Invalid URL format`,
          code: 'INVALID_URL',
          value
        });
      }
      
      if (constraints.uuid && !this.isValidUuid(value)) {
        errors.push({
          field: fieldName,
          message: `Invalid UUID format`,
          code: 'INVALID_UUID',
          value
        });
      }
    }
    
    // Number constraints
    if (typeof value === 'number') {
      if (constraints.min !== undefined && value < constraints.min) {
        errors.push({
          field: fieldName,
          message: `Value must be at least ${constraints.min}`,
          code: 'MIN_VALUE_VIOLATION',
          value
        });
      }
      
      if (constraints.max !== undefined && value > constraints.max) {
        errors.push({
          field: fieldName,
          message: `Value must be at most ${constraints.max}`,
          code: 'MAX_VALUE_VIOLATION',
          value
        });
      }
      
      if (constraints.integer && !Number.isInteger(value)) {
        errors.push({
          field: fieldName,
          message: `Value must be an integer`,
          code: 'INTEGER_REQUIRED',
          value
        });
      }
      
      if (constraints.positive && value <= 0) {
        errors.push({
          field: fieldName,
          message: `Value must be positive`,
          code: 'POSITIVE_REQUIRED',
          value
        });
      }
      
      if (constraints.negative && value >= 0) {
        errors.push({
          field: fieldName,
          message: `Value must be negative`,
          code: 'NEGATIVE_REQUIRED',
          value
        });
      }
    }
    
    // Array constraints
    if (Array.isArray(value)) {
      if (constraints.minItems !== undefined && value.length < constraints.minItems) {
        errors.push({
          field: fieldName,
          message: `Array must have at least ${constraints.minItems} items`,
          code: 'MIN_ITEMS_VIOLATION',
          value
        });
      }
      
      if (constraints.maxItems !== undefined && value.length > constraints.maxItems) {
        errors.push({
          field: fieldName,
          message: `Array must have at most ${constraints.maxItems} items`,
          code: 'MAX_ITEMS_VIOLATION',
          value
        });
      }
      
      if (constraints.uniqueItems) {
        const uniqueValues = new Set(value);
        if (uniqueValues.size !== value.length) {
          errors.push({
            field: fieldName,
            message: `Array items must be unique`,
            code: 'UNIQUE_ITEMS_VIOLATION',
            value
          });
        }
      }
    }
    
    // Custom constraints
    if (constraints.custom && !constraints.custom(value)) {
      errors.push({
        field: fieldName,
        message: `Custom validation failed`,
        code: 'CUSTOM_VALIDATION_FAILED',
        value
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  // Вспомогательные методы валидации
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
  
  private isValidUuid(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}

// Экспорт типов и классов
export {
  SchemaValidator,
  type ValidationResult,
  type ValidationError,
  type StrictFieldType,
  type StrictFieldConfig,
  type StrictTableConfig,
  type StrictDatabaseSchema,
  type RecordValidationResult,
  type ValidationContext
};