import { z } from 'zod';

type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

type SchemaField = {
    name: string;
    type: SchemaFieldType;
    description?: string;
    required: boolean;
    items?: {
        type: SchemaFieldType;
        properties: Record<string, SchemaField>;  // Changed to be more specific
    };
};

const isValidFieldType = (type: string): type is SchemaFieldType => {
    return ['string', 'number', 'boolean', 'array', 'object'].includes(type);
};

export function buildStateSchema(fields: SchemaField[]): z.ZodSchema {
    const schemaObject: Record<string, z.ZodTypeAny> = {};
    
    for (const field of fields) {
        let fieldSchema: z.ZodTypeAny;
        
        switch (field.type) {
            case 'string':
                fieldSchema = z.string();
                break;
            case 'number':
                fieldSchema = z.number();
                break;
            case 'boolean':
                fieldSchema = z.boolean();
                break;
            case 'array':
                if (field.items) {
                    if (!isValidFieldType(field.items.type)) {
                        throw new Error(`Invalid field type: ${field.items.type}`);
                    }
                    
                    // Handle array items based on their type
                    if (field.items.type === 'object' && field.items.properties) {
                        const subFields = Object.entries(field.items.properties).map(
                            ([key, fieldDef]) => ({
                                name: key,
                                type: fieldDef.type,
                                required: fieldDef.required,
                                description: fieldDef.description,
                                items: fieldDef.items
                            })
                        );
                        fieldSchema = z.array(buildStateSchema(subFields));
                    } else {
                        // For primitive types, create a simple array
                        fieldSchema = z.array(buildStateSchema([{
                            name: 'item',
                            type: field.items.type,
                            required: true,
                            description: field.description
                        }]));
                    }
                } else {
                    fieldSchema = z.array(z.any());
                }
                break;
            case 'object':
                if (field.items?.properties) {
                    const subFields = Object.entries(field.items.properties).map(
                        ([key, fieldDef]) => ({
                            name: key,
                            type: fieldDef.type,
                            required: fieldDef.required,
                            description: fieldDef.description,
                            items: fieldDef.items
                        })
                    );
                    fieldSchema = buildStateSchema(subFields);
                } else {
                    fieldSchema = z.record(z.any());
                }
                break;
            default:
                fieldSchema = z.any();
        }
        
        schemaObject[field.name] = field.required ? fieldSchema : fieldSchema.optional();
    }
    
    return z.object(schemaObject);
}