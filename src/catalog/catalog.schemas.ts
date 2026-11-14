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
