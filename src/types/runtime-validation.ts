/**
 * Runtime валидация типов для SurrealDB ORM
 */

import type { FieldConfig, TableConfig, DatabaseSchema } from '../../orm';
import { ValidationError } from './error-handling';

/**
 * Валидатор для базовых типов
 */
export class TypeValidator {
	/**
	 * Валидация строки
	 */
	static validateString(value: unknown, fieldName: string): string {
		if (typeof value !== 'string') {
			throw new ValidationError(
				`Field '${fieldName}' must be a string, got ${typeof value}`,
				fieldName,
				value
			);
		}
		return value;
	}

	/**
	 * Валидация числа
	 */
	static validateNumber(value: unknown, fieldName: string): number {
		if (typeof value !== 'number' || isNaN(value)) {
			throw new ValidationError(
				`Field '${fieldName}' must be a number, got ${typeof value}`,
				fieldName,
				value
			);
		}
		return value;
	}

	/**
	 * Валидация булева значения
	 */
	static validateBoolean(value: unknown, fieldName: string): boolean {
		if (typeof value !== 'boolean') {
			throw new ValidationError(
				`Field '${fieldName}' must be a boolean, got ${typeof value}`,
				fieldName,
				value
			);
		}
		return value;
	}

	/**
	 * Валидация даты
	 */
	static validateDate(value: unknown, fieldName: string): Date {
		if (value instanceof Date) {
			return value;
		}

		if (typeof value === 'string' || typeof value === 'number') {
			const date = new Date(value);
			if (isNaN(date.getTime())) {
				throw new ValidationError(
					`Field '${fieldName}' must be a valid date, got ${value}`,
					fieldName,
					value
				);
			}
			return date;
		}

		throw new ValidationError(
			`Field '${fieldName}' must be a date, got ${typeof value}`,
			fieldName,
			value
		);
	}

	/**
	 * Валидация объекта
	 */
	static validateObject(
		value: unknown,
		fieldName: string
	): Record<string, unknown> {
		if (
			typeof value !== 'object' ||
			value === null ||
			Array.isArray(value)
		) {
			throw new ValidationError(
				`Field '${fieldName}' must be an object, got ${typeof value}`,
				fieldName,
				value
			);
		}
		return value as Record<string, unknown>;
	}

	/**
	 * Валидация массива
	 */
	static validateArray(value: unknown, fieldName: string): unknown[] {
		if (!Array.isArray(value)) {
			throw new ValidationError(
				`Field '${fieldName}' must be an array, got ${typeof value}`,
				fieldName,
				value
			);
		}
		return value;
	}

	/**
	 * Валидация ID записи
	 */
	static validateRecordId(
		value: unknown,
		fieldName: string,
		expectedTable?: string
	): string {
		const stringValue = this.validateString(value, fieldName);

		if (!stringValue.includes(':')) {
			throw new ValidationError(
				`Field '${fieldName}' must be a valid record ID (table:id), got ${stringValue}`,
				fieldName,
				value
			);
		}

		if (expectedTable) {
			const [table] = stringValue.split(':');
			if (table !== expectedTable) {
				throw new ValidationError(
					`Field '${fieldName}' must reference table '${expectedTable}', got '${table}'`,
					fieldName,
					value
				);
			}
		}

		return stringValue;
	}
}

/**
 * Валидатор для полей таблицы
 */
export class FieldValidator {
	/**
	 * Валидация значения поля согласно конфигурации
	 */
	static validateField(
		value: unknown,
		fieldName: string,
		config: FieldConfig
	): unknown {
		// Проверка обязательности
		if (config.required && (value === null || value === undefined)) {
			throw new ValidationError(
				`Required field '${fieldName}' is missing`,
				fieldName,
				value
			);
		}

		// Если значение null/undefined и поле не обязательное
		if (value === null || value === undefined) {
			return value;
		}

		// Валидация по типу
		switch (config.type) {
			case 'string':
				return TypeValidator.validateString(value, fieldName);

			case 'number':
				return TypeValidator.validateNumber(value, fieldName);

			case 'bool':
				return TypeValidator.validateBoolean(value, fieldName);

			case 'datetime':
				return TypeValidator.validateDate(value, fieldName);

			case 'object':
				return TypeValidator.validateObject(value, fieldName);

			case 'array':
				const arrayValue = TypeValidator.validateArray(
					value,
					fieldName
				);
				if (config.arrayOf) {
					// Валидация элементов массива
					if (typeof config.arrayOf === 'string') {
						for (let i = 0; i < arrayValue.length; i++) {
							this.validateField(
								arrayValue[i],
								`${fieldName}[${i}]`,
								{
									type: config.arrayOf,
									required: false,
								}
							);
						}
					} else if (
						typeof config.arrayOf === 'object' &&
						'record' in config.arrayOf
					) {
						for (let i = 0; i < arrayValue.length; i++) {
							TypeValidator.validateRecordId(
								arrayValue[i],
								`${fieldName}[${i}]`,
								config.arrayOf.record
							);
						}
					}
				}
				return arrayValue;

			case 'record':
				if (config.references) {
					return TypeValidator.validateRecordId(
						value,
						fieldName,
						config.references
					);
				}
				return TypeValidator.validateRecordId(value, fieldName);

			default:
				throw new ValidationError(
					`Unknown field type '${config.type}' for field '${fieldName}'`,
					fieldName,
					value
				);
		}
	}

	/**
	 * Валидация объекта записи согласно схеме таблицы
	 */
	static validateRecord(
		data: Record<string, unknown>,
		tableName: string,
		config: TableConfig
	): Record<string, unknown> {
		const validatedData: Record<string, unknown> = {};

		// Валидация полей схемы
		for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
			const value = data[fieldName];
			validatedData[fieldName] = this.validateField(
				value,
				fieldName,
				fieldConfig
			);
		}

		// Проверка на лишние поля (если включена строгая валидация)
		// Note: TableConfig не имеет поля strict, поэтому пропускаем эту проверку

		return validatedData;
	}
}

/**
 * Валидатор для схемы базы данных
 */
export class SchemaValidator {
	/**
	 * Валидация конфигурации поля
	 */
	static validateFieldConfig(
		config: unknown,
		fieldName: string,
		tableName: string
	): FieldConfig {
		if (typeof config !== 'object' || config === null) {
			throw new ValidationError(
				`Field config for '${tableName}.${fieldName}' must be an object`,
				fieldName,
				config
			);
		}

		const fieldConfig = config as Record<string, unknown>;

		if (typeof fieldConfig.type !== 'string') {
			throw new ValidationError(
				`Field '${tableName}.${fieldName}' must have a type`,
				fieldName,
				config
			);
		}

		const validTypes = [
			'string',
			'number',
			'bool',
			'datetime',
			'object',
			'array',
			'record',
		];
		if (!validTypes.includes(fieldConfig.type)) {
			throw new ValidationError(
				`Field '${tableName}.${fieldName}' has invalid type '${fieldConfig.type}'`,
				fieldName,
				config
			);
		}

		return {
			type: fieldConfig.type as FieldConfig['type'],
			required: Boolean(fieldConfig.required),
			default: fieldConfig.default,
			readonly: Boolean(fieldConfig.readonly),
			valueExpr:
				typeof fieldConfig.valueExpr === 'string' ?
					fieldConfig.valueExpr
				:	undefined,
			constraints:
				(
					typeof fieldConfig.constraints === 'object' &&
					fieldConfig.constraints !== null
				) ?
					(fieldConfig.constraints as Record<string, unknown>)
				:	undefined,
			references:
				typeof fieldConfig.references === 'string' ?
					fieldConfig.references
				:	undefined,
			arrayOf: fieldConfig.arrayOf as FieldConfig['arrayOf'],
		};
	}

	/**
	 * Валидация конфигурации таблицы
	 */
	static validateTableConfig(
		config: unknown,
		tableName: string
	): TableConfig {
		if (typeof config !== 'object' || config === null) {
			throw new ValidationError(
				`Table config for '${tableName}' must be an object`,
				tableName,
				config
			);
		}

		const tableConfig = config as Record<string, unknown>;

		if (
			typeof tableConfig.fields !== 'object' ||
			tableConfig.fields === null
		) {
			throw new ValidationError(
				`Table '${tableName}' must have fields configuration`,
				tableName,
				config
			);
		}

		const fields: Record<string, FieldConfig> = {};
		for (const [fieldName, fieldConfig] of Object.entries(
			tableConfig.fields
		)) {
			fields[fieldName] = this.validateFieldConfig(
				fieldConfig,
				fieldName,
				tableName
			);
		}

		return {
			fields,
			permissions: tableConfig.permissions as TableConfig['permissions'],
			indexes: tableConfig.indexes as TableConfig['indexes'],
		};
	}

	/**
	 * Валидация схемы базы данных
	 */
	static validateDatabaseSchema(schema: unknown): DatabaseSchema {
		if (typeof schema !== 'object' || schema === null) {
			throw new ValidationError(
				'Database schema must be an object',
				'schema',
				schema
			);
		}

		const databaseSchema: DatabaseSchema = {};
		for (const [tableName, tableConfig] of Object.entries(schema)) {
			databaseSchema[tableName] = this.validateTableConfig(
				tableConfig,
				tableName
			);
		}

		return databaseSchema;
	}
}

/**
 * Декоратор для автоматической валидации методов
 */
export function validateInput<T extends Record<string, unknown>>(
	validator: (data: unknown) => T
) {
	return function (
		target: any,
		propertyName: string,
		descriptor: PropertyDescriptor
	) {
		const method = descriptor.value;

		descriptor.value = function (...args: any[]) {
			// Валидируем первый аргумент (обычно это данные)
			if (args.length > 0) {
				args[0] = validator(args[0]);
			}
			return method.apply(this, args);
		};

		return descriptor;
	};
}

/**
 * Фабрика валидаторов для таблиц
 */
export function createTableValidator<T extends TableConfig>(
	tableName: string,
	config: T
) {
	return {
		validateRecord: (data: Record<string, unknown>) =>
			FieldValidator.validateRecord(data, tableName, config),

		validateField: (fieldName: string, value: unknown) => {
			const fieldConfig = config.fields[fieldName];
			if (!fieldConfig) {
				throw new ValidationError(
					`Unknown field '${fieldName}' in table '${tableName}'`,
					fieldName,
					value
				);
			}
			return FieldValidator.validateField(value, fieldName, fieldConfig);
		},
	};
}
