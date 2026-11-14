import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CategorySchema = z.object({ id: z.uuid(), name: z.string() });
export class CategoryDto extends createZodDto(CategorySchema) {}

export const CitySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  province: z.string(),
});
export class CityDto extends createZodDto(CitySchema) {}

export class TagSuggestQuery extends createZodDto(
  z.object({ prefix: z.string().min(1).max(40) }),
) {}

export const TagSuggestionsSchema = z.object({ tags: z.array(z.string()) });
export class TagSuggestionsDto extends createZodDto(TagSuggestionsSchema) {}

// Admin side: archived entries included, so they can be unarchived.
const name = z.string().trim().min(1).max(60);
const sortOrder = z.int().min(0).max(10_000);

export const AdminCategorySchema = CategorySchema.extend({
  sortOrder: z.int(),
  archived: z.boolean(),
});
export class AdminCategoryDto extends createZodDto(AdminCategorySchema) {}
export class CreateCategoryDto extends createZodDto(
  z.object({ name, sortOrder: sortOrder.optional() }),
) {}
export class UpdateCategoryDto extends createZodDto(
  z.object({
    name: name.optional(),
    sortOrder: sortOrder.optional(),
    archived: z.boolean().optional(),
  }),
) {}

export const AdminCitySchema = CitySchema.extend({ archived: z.boolean() });
export class AdminCityDto extends createZodDto(AdminCitySchema) {}
export class CreateCityDto extends createZodDto(
  z.object({ name, province: name }),
) {}
export class UpdateCityDto extends createZodDto(
  z.object({
    name: name.optional(),
    province: name.optional(),
    archived: z.boolean().optional(),
  }),
) {}
