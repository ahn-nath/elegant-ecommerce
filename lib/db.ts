import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
}

const mongoUri = process.env.MONGODB_URI;
const MONGODB_URI: string = mongoUri ?? "";

/** * Global is used here to maintain a cached connection
 * across hot-reloads in development.
 */
let cached: MongooseCache = global.mongoose ?? { conn: null, promise: null };

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

global.mongoose = cached;

export default async function connectDB() {
  if (!MONGODB_URI) {
    return null;
  }

  // If we already have a connection, use it!
  if (cached.conn) {
    return cached.conn;
  }

  // If we are currently connecting, wait for that promise
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      console.log("✅ New MongoDB connection established: elegant");
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error("❌ Database Error:", e);
    throw e;
  }

  return cached.conn;
}
