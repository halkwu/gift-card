import { ApolloServer} from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphQLScalarType, Kind } from 'graphql';
import { loginCard, fetchDataFromSession, closeSession } from './everyday';

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

const sessionCache = new Map<string, Promise<any> | any>();

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
    account: async (_: any, { identifier }: { identifier?: string }, context: any) => {
      try {
        // Support both new random identifier keys and legacy `card:pin:headless` keys
        const resolveSessionAndKey = (ident?: string) => {
          if (!ident) return { entry: null as any, key: null as any };
          // If identifier looks like legacy (has ':'), prefer legacy key if present
          if (ident.includes(':')) {
            const parts = ident.split(':');
            const id = parts[0] || '';
            const pin = parts[1] || '';
            const useHeadless = parts.length >= 3 ? parts[2] !== 'false' : true;
            const legacyKey = `${id}:${pin}:${useHeadless}`;
            if (sessionCache.has(legacyKey)) return { entry: sessionCache.get(legacyKey), key: legacyKey };
            // otherwise fallthrough to treat `ident` as direct key
          }
          return { entry: sessionCache.get(ident), key: ident };
        };

        const { entry, key } = resolveSessionAndKey(identifier as string | undefined);
        if (!entry) return [];
        const session: any = await entry;
        if (!session) return [];
        const details: any = await fetchDataFromSession(session);
        if (!details) return [];

        // close browser and clear cache after successful fetch
        try { await closeSession(session); } catch (_) {}
        if (key) sessionCache.delete(key);

        return [{
          id: details.cardNumber,
          name: 'Everyday Gift Card',
          balance: details.balance,
          currency: details.currency || 'AUD'
        }];
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Failed to fetch account';
        throw new Error(msg);
      }
    },
    transaction: async (_: any, { identifier }: { identifier?: string }, context: any) => {
      try {
        const resolveSessionAndKey = (ident?: string) => {
          if (!ident) return { entry: null as any, key: null as any };
          if (ident.includes(':')) {
            const parts = ident.split(':');
            const id = parts[0] || '';
            const pin = parts[1] || '';
            const useHeadless = parts.length >= 3 ? parts[2] !== 'false' : true;
            const legacyKey = `${id}:${pin}:${useHeadless}`;
            if (sessionCache.has(legacyKey)) return { entry: sessionCache.get(legacyKey), key: legacyKey };
          }
          return { entry: sessionCache.get(ident), key: ident };
        };

        const { entry, key } = resolveSessionAndKey(identifier as string | undefined);
        if (!entry) return [];
        const session: any = await entry;
        if (!session) return [];
        const details: any = await fetchDataFromSession(session);
        if (!details || !Array.isArray(details.transactions)) return [];

        // Attempt to use a human-friendly id prefix when available
        const prefix = (identifier && identifier.includes(':')) ? identifier.split(':')[0] : identifier || '';

        // close browser and clear cache after successful fetch
        try { await closeSession(session); } catch (_) {}
        if (key) sessionCache.delete(key);

        return details.transactions.map((t: any, idx: number) => ({
          transactionId: `${prefix}-${idx + 1}`,
          transactionTime: t.transactionTime || t.date,
          amount: t.amount,
          currency: t.currency || details.currency || 'AUD',
          description: t.description,
          status: 'confirmed',
          balance: t.balance,
        }));
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Failed to fetch transactions';
        throw new Error(msg);
      }
    }
  },
  Mutation: {
    auth: async (_: any, { payload }: { payload: any }) => {
      try {
        let card = '';
        let pin = '';
        let useHeadless = false; // default to headless sessions

        if (typeof payload === 'string') {
          const parts = payload.split(':');
          card = parts[0] || '';
          pin = parts[1] || '';
          if (parts.length >= 3) useHeadless = parts[2] !== 'false';
        } else if (payload && typeof payload === 'object') {
          card = payload.cardNumber || payload.id || payload.identifier || '';
          pin = payload.pin || '';
          if (typeof payload.headless === 'boolean') useHeadless = payload.headless;
          else if (typeof payload.headless === 'string') useHeadless = payload.headless !== 'false';
        }

        if (!card) return { response: 'error', identifier: '' };

        // generate a random base36 identifier and ensure uniqueness
        let identifier: string;
        do {
          identifier = Math.random().toString(36).slice(2);
        } while (sessionCache.has(identifier));

        // store the pending session promise so concurrent requests share the same work
        sessionCache.set(identifier, loginCard(card, pin || '', useHeadless));

        const session = await sessionCache.get(identifier);
        if (!session) {
          sessionCache.delete(identifier);
          // login failed (wrong credentials) -> return fail and null identifier
          return { response: 'fail', identifier: null };
        }
        return { response: 'success', identifier };
      } catch (e: any) {
        return { response: (e && e.message) ? e.message : 'error', identifier: '' };
      }
    }
  }
};

async function start() {
  const server = new ApolloServer({ typeDefs, resolvers });
  const { url } = await server.listen({ port: 4000 });
  console.log(`GraphQL server running at ${url}`);
}

start().catch((e) => {
  console.error('Failed to start GraphQL server', e);
  process.exit(1);
});
