import { ApolloServer } from 'apollo-server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GetResult } from './everyday';

const typeDefs = readFileSync(join(__dirname, '..', 'schema.graphql'), 'utf8');

const resolvers = {
  Query: {
    checkGiftCard: async (_: any, args: { cardNumber: string; pin: string; headless?: boolean }) => {
      const { cardNumber, pin, headless = false } = args;
      try {
        const res = await GetResult(cardNumber, pin, headless);
        return res;
      } catch (err) {
        throw new Error(String(err));
      }
    },
  },
};

async function start() {
  const server = new ApolloServer({ typeDefs, resolvers });
  const { url } = await server.listen({ port: 4000 });
  // eslint-disable-next-line no-console
  console.log(`GraphQL server running at ${url}`);
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start GraphQL server:', err);
  process.exit(1);
});
