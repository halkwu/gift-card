(# Everyday Usage)

**Everyday Operations**
- **Prerequisites:** Install Node.js (recommended Node 16+) and npm. This project uses `ts-node` to run TypeScript files; `ts-node` is listed in `everyday/package.json` devDependencies.
- **Install dependencies:** Run the following in the `everyday` directory:

```bash
cd everyday
npm install
```
- **Common scripts (run in the `everyday` directory):**
	- `npm run everyday` — runs `ts-node everyday.ts`
	- `npm run start:graphql` — runs `ts-node graphql-server.ts` (starts a GraphQL server for queries/debugging)
	- `npm run start` — runs `ts-node giftcard.ts`

```bash
# Example: start the GraphQL server
cd everyday
npm run start:graphql
```

**Example GraphQL query**

The GraphQL server started by `graphql-server.ts` typically exposes an endpoint such as `http://localhost:4000/graphql` (see `everyday/graphql-server.ts` to confirm the port). 
Example graphql request:

```graphql
query {
  checkEveryday(cardNumber:"6280005616388591380", pin:"8937", headless:true) {
    balance
    cardNumber
    expiryDate
    purchases
    transactions {
      date
      description
      amount
      balance
    }
  }
}
```

**Files to check**
- `everyday/everyday.ts` — main everyday script
- `everyday/graphql-server.ts` — GraphQL server implementation
- `everyday/package.json` — npm scripts and dependencies

**Troubleshooting**
- If you see errors about `ts-node` or types, ensure you ran `npm install` inside `everyday` and that your Node version meets the requirement.
- If `npm run start:graphql` fails, check the terminal output for the listening port or errors in `everyday/graphql-server.ts`.

If you want, I can add a playground example, Postman/import file, or adapt the GraphQL example to the exact schema exposed by `graphql-server.ts`.
