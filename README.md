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
	- `npm run start:graphql` — runs `ts-node everyday_api.ts` (starts a GraphQL server for queries/debugging)

```bash
# Example: start the GraphQL server
cd everyday
npm run start:graphql
```

(# giftcard Usage for reCAPTCHA)

```bash
cd giftcard
npm install
```
- **Common scripts (run in the `giftcard` directory):**
	- `npx ts-node giftcard.ts`
	- `npx ts-node giftcard_api.ts`

```bash
# Example: start the GraphQL server
Remove-Item 'C:\pw-chrome-profile' -Recurse -Force -ErrorAction SilentlyContinue ; New-Item -ItemType Directory -Path 'C:\pw-chrome-profile' -Force ; Get-ChildItem 'C:\pw-chrome-profile' | Select-Object FullName, Attributes
cd giftcard
npx ts-node giftcard_api.ts
```

**Example GraphQL query**
The GraphQL server started by `graphql-server.ts` typically exposes an endpoint such as `http://localhost:4000/graphql` (see `everyday/everyday_api.ts` to confirm the port). 
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
- `everyday/everyday_api.ts` — GraphQL server implementation
- `everyday/package.json` — npm scripts and dependencies

**Troubleshooting**
- If you see errors about `ts-node` or types, ensure you ran `npm install` inside `everyday` and that your Node version meets the requirement.
- If `npm run start:graphql` fails, check the terminal output for the listening port or errors in `everyday/everyday_api.ts`.

If you want, I can add a playground example, Postman/import file, or adapt the GraphQL example to the exact schema exposed by `everyday_api.ts`.
