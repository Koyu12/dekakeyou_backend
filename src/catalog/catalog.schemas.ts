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
