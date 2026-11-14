import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/auth/auth.decorators';
import { CatalogService } from './catalog.service';
import { CategoryDto, CityDto } from './catalog.schemas';

const PUBLIC_CACHE = 'public, max-age=60';

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ZodResponse({ status: 200, type: [CategoryDto] })
  listCategories() {
    return this.catalog.listCategories();
  }

  @Get('cities')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ZodResponse({ status: 200, type: [CityDto] })
  listCities() {
    return this.catalog.listCities();
  }
}
