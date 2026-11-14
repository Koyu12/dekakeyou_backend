import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// Placeholder starting lists; the Admin edits them later without a deploy.
const categories = ['Anime & Manga', 'Cosplay', 'J-Music', 'Idol', 'Gaming', 'Japanese Culture'];

const cities: [name: string, province: string][] = [
  ['Jakarta', 'DKI Jakarta'],
  ['Bogor', 'Jawa Barat'],
  ['Depok', 'Jawa Barat'],
  ['Bekasi', 'Jawa Barat'],
  ['Bandung', 'Jawa Barat'],
  ['Tangerang', 'Banten'],
  ['Semarang', 'Jawa Tengah'],
  ['Yogyakarta', 'DI Yogyakarta'],
  ['Surabaya', 'Jawa Timur'],
  ['Malang', 'Jawa Timur'],
  ['Denpasar', 'Bali'],
  ['Medan', 'Sumatera Utara'],
  ['Palembang', 'Sumatera Selatan'],
  ['Makassar', 'Sulawesi Selatan'],
  ['Balikpapan', 'Kalimantan Timur'],
];

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    for (const [sortOrder, name] of categories.entries()) {
      await prisma.category.upsert({ where: { name }, create: { name, sortOrder }, update: {} });
    }
    for (const [name, province] of cities) {
      await prisma.city.upsert({
        where: { name_province: { name, province } },
        create: { name, province },
        update: {},
      });
    }
    console.log(`Seeded ${categories.length} categories and ${cities.length} cities`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
