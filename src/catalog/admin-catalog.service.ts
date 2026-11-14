import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { Category, City, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deleteRefusal } from './catalog.rules';
import type {
  AdminCategoryDto,
  AdminCityDto,
  CreateCategoryDto,
  CreateCityDto,
  UpdateCategoryDto,
  UpdateCityDto,
} from './catalog.schemas';

/** The Admin edits the Category and City lists. Archived entries vanish from public lists and pickers. */
@Injectable()
export class AdminCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<AdminCategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toAdminCategory);
  }

  async createCategory(input: CreateCategoryDto) {
    return toAdminCategory(
      await write('Category', () =>
        this.prisma.category.create({ data: input }),
      ),
    );
  }

  async updateCategory(id: string, { archived, ...rest }: UpdateCategoryDto) {
    return toAdminCategory(
      await write('Category', () =>
        this.prisma.category.update({
          where: { id },
          data: { ...rest, archivedAt: archivedAt(archived) },
        }),
      ),
    );
  }

  async deleteCategory(id: string) {
    refuseIfUsed(await this.prisma.event.count({ where: { categoryId: id } }));
    await write('Category', () =>
      this.prisma.category.delete({ where: { id } }),
    );
  }

  async listCities(): Promise<AdminCityDto[]> {
    const rows = await this.prisma.city.findMany({
      orderBy: [{ province: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toAdminCity);
  }

  async createCity(input: CreateCityDto) {
    return toAdminCity(
      await write('City', () => this.prisma.city.create({ data: input })),
    );
  }

  async updateCity(id: string, { archived, ...rest }: UpdateCityDto) {
    return toAdminCity(
      await write('City', () =>
        this.prisma.city.update({
          where: { id },
          data: { ...rest, archivedAt: archivedAt(archived) },
        }),
      ),
    );
  }

  async deleteCity(id: string) {
    refuseIfUsed(await this.prisma.event.count({ where: { cityId: id } }));
    await write('City', () => this.prisma.city.delete({ where: { id } }));
  }
}

const archivedAt = (archived?: boolean) =>
  archived === undefined ? undefined : archived ? new Date() : null;

function refuseIfUsed(usedByEvents: number) {
  const why = deleteRefusal(usedByEvents);
  if (why) throw new AppError('CATALOG_ENTRY_IN_USE', 409, why);
}

/** Turns the database's answers (duplicate name, missing row, still referenced) into error codes. */
async function write<T>(what: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
    if (err.code === 'P2002') {
      throw new AppError(
        'CATALOG_NAME_TAKEN',
        409,
        `A ${what} with this name already exists`,
      );
    }
    if (err.code === 'P2025') {
      throw new AppError('NOT_FOUND', 404, `${what} not found`);
    }
    // An Event took it between the count and the delete.
    if (err.code === 'P2003') refuseIfUsed(1);
    throw err;
  }
}

const toAdminCategory = (c: Category): AdminCategoryDto => ({
  id: c.id,
  name: c.name,
  sortOrder: c.sortOrder,
  archived: c.archivedAt !== null,
});

const toAdminCity = (c: City): AdminCityDto => ({
  id: c.id,
  name: c.name,
  province: c.province,
  archived: c.archivedAt !== null,
});
