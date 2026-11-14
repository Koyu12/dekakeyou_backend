import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/auth/auth.decorators';
import { normalizeTag } from './catalog.rules';
import {
  CategoryDto,
  CityDto,
  TagSuggestionsDto,
  TagSuggestQuery,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';

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

  /** Tag suggestions while typing: GET /tags?prefix=gen → { tags: ["genshin-impact", …] }. */
  @Get('tags')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ZodResponse({ status: 200, type: TagSuggestionsDto })
  async suggestTags(@Query() { prefix }: TagSuggestQuery) {
    const normalized = normalizeTag(prefix);
    return {
      tags: normalized ? await this.catalog.suggestTags(normalized) : [],
    };
  }
}
