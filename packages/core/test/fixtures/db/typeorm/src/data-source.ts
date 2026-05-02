import { DataSource } from 'typeorm'

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'typeorm-host',
  port: 5432,
  database: 'typeorm_db',
})
