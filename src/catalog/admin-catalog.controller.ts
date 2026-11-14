import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Roles } from '../common/auth/auth.decorators';
import { NO_STORE } from '../common/http/cache';
import { AdminCatalogService } from './admin-catalog.service';
import {
  AdminCategoryDto,
  AdminCityDto,
  CreateCategoryDto,
  CreateCityDto,
  UpdateCategoryDto,
  UpdateCityDto,
} from './catalog.schemas';

@ApiTags('admin: catalog')
@Roles('admin')
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  /** All Categories, archived included. */
  @Get('categories')
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: [AdminCategoryDto] })
  listCategories() {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @ZodResponse({ status: 201, type: AdminCategoryDto })
  createCategory(@Body() body: CreateCategoryDto) {
    return this.catalog.createCategory(body);
  }

  /** Rename, reorder (sortOrder), archive or unarchive (archived: true/false). */
  @Patch('categories/:id')
  @ZodResponse({ status: 200, type: AdminCategoryDto })
  updateCategory(@Param('id') id: string, @Body() body: UpdateCategoryDto) {
    return this.catalog.updateCategory(id, body);
  }

  /** Only when no Event uses it (else 409 CATALOG_ENTRY_IN_USE: archive instead). */
  @Delete('categories/:id')
  @HttpCode(204)
  deleteCategory(@Param('id') id: string) {
    return this.catalog.deleteCategory(id);
  }

  /** All Cities, archived included. */
  @Get('cities')
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: [AdminCityDto] })
  listCities() {
    return this.catalog.listCities();
  }

  @Post('cities')
  @ZodResponse({ status: 201, type: AdminCityDto })
  createCity(@Body() body: CreateCityDto) {
    return this.catalog.createCity(body);
  }

  /** Rename (name, province), archive or unarchive (archived: true/false). */
  @Patch('cities/:id')
  @ZodResponse({ status: 200, type: AdminCityDto })
  updateCity(@Param('id') id: string, @Body() body: UpdateCityDto) {
    return this.catalog.updateCity(id, body);
  }

  /** Only when no Event uses it (else 409 CATALOG_ENTRY_IN_USE: archive instead). */
  @Delete('cities/:id')
  @HttpCode(204)
  deleteCity(@Param('id') id: string) {
    return this.catalog.deleteCity(id);
  }
}
