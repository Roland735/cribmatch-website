import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

const globalForMongo = globalThis;

let clientPromise = globalForMongo._mongoClientPromise;

if (!clientPromise) {
  if (!uri) {
    clientPromise = Promise.reject(new Error("MONGODB_URI is not set"));
  } else {
    const client = new MongoClient(uri);
    clientPromise = client.connect();
    globalForMongo._mongoClientPromise = clientPromise;
  }
}

export default clientPromise;
