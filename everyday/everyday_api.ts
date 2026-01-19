import { ApolloServer} from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { requestSession, queryWithSession } from './everyday';

// Concurrency / queueing: allow up to 3 concurrent active sessions;
// additional auth requests are queued FIFO until a slot becomes available.
const MAX_CONCURRENT = 3;
let activeCount = 0;
const waitQueue: Array<{ id: number; resolve: () => void }> = [];
let nextProcessId = 1;
let releaseCount = 0;
const heldIdentifiers = new Set<string>();

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    console.log(`[concurrency] acquired slot -> active=${activeCount}, queue=${waitQueue.length}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const id = nextProcessId++;
    waitQueue.push({ id, resolve });
    console.log(`[concurrency] queued process#${id} -> active=${activeCount}, queue=${waitQueue.length}`);
  });
}

function releaseSlot() {
  if (activeCount <= 0) return;
  activeCount--;
  releaseCount++;
  const next = waitQueue.shift();
  console.log(`[concurrency] released ${releaseCount} slot(s)`);
  if (next) {
    // allocate slot for next waiter then notify it
    activeCount++;
    console.log(`[concurrency] handing slot to process#${next.id} -> active=${activeCount}, queue=${waitQueue.length}`);
    try { next.resolve(); } catch (e) { /* ignore */ }
  }
}

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  parseValue: (value) => value,
  serialize: (value) => value,
  parseLiteral: (ast) => {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value);
      case Kind.OBJECT: {
        const value: any = Object.create(null);
        ast.fields.forEach((field: any) => {
          value[field.name.value] = parseLiteral(field.value);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map(parseLiteral);
      default:
        return null;
    }
  }
});

function parseLiteral(ast: any): any {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.OBJECT: {
      const value: any = Object.create(null);
      ast.fields.forEach((field: any) => {
        value[field.name.value] = parseLiteral(field.value);
      });
      return value;
    }
    case Kind.LIST:
      return ast.values.map(parseLiteral);
    default:
      return null;
  }
}

const resolvers = {
  JSON: JSONScalar,
  Query: {
    account: async (_: any, args: any, context: any) => {
      try {

        const storageIdentifier = args && args.identifier ? args.identifier : null;
        if (!storageIdentifier) throw new Error('Invalid or expired identifier');

        const key = typeof storageIdentifier === 'string'
          ? storageIdentifier
          : (storageIdentifier && storageIdentifier.identifier) || null;
        if (!key) throw new Error('Invalid or expired identifier');

        if (!context.fetchCache) context.fetchCache = new Map();
        if (!context.fetchCache.has(key)) {

          context.fetchCache.set(key, (queryWithSession as any)(storageIdentifier));
        }
        const details: any = await context.fetchCache.get(key);
        try {
          if (!details) throw new Error('Invalid or expired identifier');
          return [{
            id: details.cardNumber,
            name: 'Everyday Gift Card',
            balance: details.balance,
            currency: details.currency
          }];
        } finally {
          if (key && heldIdentifiers.has(key)) {
            heldIdentifiers.delete(key);
            releaseSlot();
          }
        }
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Failed to fetch account';
        throw new Error(msg);
      }
    },
    
    transaction: async (_: any, args: any, context: any) => {
      try {
        const storageIdentifier = args && args.identifier ? args.identifier : null;
        if (!storageIdentifier) throw new Error('Invalid or expired identifier');

        const key = typeof storageIdentifier === 'string'
          ? storageIdentifier
          : (storageIdentifier && storageIdentifier.identifier) || null;
        if (!key) throw new Error('Invalid or expired identifier');

        if (!context.fetchCache) context.fetchCache = new Map();
        if (!context.fetchCache.has(key)) {

          context.fetchCache.set(key, (queryWithSession as any)(storageIdentifier));
        }
        const details: any = await context.fetchCache.get(key);
        try {
          if (!details) throw new Error('Invalid or expired identifier');
          const prefix = details.cardNumber;
          return details.transactions.map((t: any, idx: number) => ({
            transactionId: `${prefix}-${idx + 1}`,
            transactionTime: t.transactionTime,
            amount: t.amount,
            currency: t.currency,
            description: t.description,
            status: 'confirmed',
            balance: t.balance,
          }));
        } finally {
          if (key && heldIdentifiers.has(key)) {
            heldIdentifiers.delete(key);
            releaseSlot();
          }
        }
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Failed to fetch transactions';
        throw new Error(msg);
      }
    }
  },
  Mutation: {
    auth: async (_: any, { payload }: { payload: any }, context: any) => {
      try {
        const { id, pin } = payload || {};
        
        if (id && pin) {
          await acquireSlot();
          try {
            const res = await requestSession(id, pin, false);
            if (res && res.response === 'success' && res.identifier) {
              heldIdentifiers.add(res.identifier);
              return { response: res.response, identifier: res.identifier };
            }
            // request failed, release reserved slot
            releaseSlot();
            return { response: res ? res.response : 'fail', identifier: null };
          } catch (e: any) {
            releaseSlot();
            return { response: e && e.message ? e.message : 'error', identifier: null };
          }
        }
      } catch (err: any) {
        return { response: err && err.message ? err.message : 'error', identifier: null };
      }
    }
  }
};

async function start() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }: { req: any }) => ({ headers: req ? req.headers : {}, fetchCache: new Map() })
  });
  const { url } = await server.listen({ port: 4000 });
  console.log(`GraphQL server running at ${url}`);
}

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});
