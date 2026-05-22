/**
 * Shared in-memory MongoDB setup for Jest tests.
 * Each test file that needs DB access should call connect() in beforeAll
 * and disconnect() in afterAll.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod;

async function connect() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (!mongod) return;
  await mongod.stop();
}

async function clearAll() {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export { connect, disconnect, clearAll };
