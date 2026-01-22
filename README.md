(# Everyday Usage)

**Everyday Operations**
- **Prerequisites:** Install Node.js (recommended Node 16+) and npm. This project uses `ts-node` to run TypeScript files; `ts-node` is listed in `everyday/package.json` devDependencies.
- **Install dependencies:** Run the following in the `everyday` directory:

```bash
cd everyday
npm install
```

```bash
# Example: start the GraphQL server
cd everyday
npx ts-node everyday_api.ts
```

**Example GraphQL query**
The GraphQL server started by `graphql-server.ts` typically exposes an endpoint such as `http://localhost:4000/graphql` (see `everyday/everyday_api.ts` to confirm the port). 
Example graphql request:

```graphql everyday

Authentication
mutation Auth($payload: JSON) {
  auth(payload: $payload) {
    response
    identifier
  }
}

query GetBalanceAndTxs($identifier: String) {
  account(identifier: $identifier) {
    id
    name
    balance
    currency
  }
  transaction(identifier: $identifier) {
      transactionId
      transactionTime
      amount
      currency
			description
      status
      balance
    }
  }
```

```mutation variables
{
	"payload": {
		"id": "6280005616388591380",
		"pin": "8937"
	}
}

```

```query variables
{
	"identifier": "" (Get from mutation)
}

```

(# giftcard Usage for reCAPTCHA)
```bash
cd giftcard
npm install
```
- **Common scripts (run in the `giftcard` directory):**
	- `npx ts-node giftcard_api.ts`

```bash
# Example: start the GraphQL server
Remove-Item 'C:\pw-chrome-profile' -Recurse -Force -ErrorAction SilentlyContinue ; New-Item -ItemType Directory -Path 'C:\pw-chrome-profile' -Force ; Get-ChildItem 'C:\pw-chrome-profile' | Select-Object FullName, Attributes
cd giftcard
npx ts-node giftcard_api.ts
```

**Example GraphQL query**
The GraphQL server started by `graphql-server.ts` typically exposes an endpoint such as `http://localhost:4000/graphql` (see `giftcard/giftcard_api.ts` to confirm the port). 
Example graphql request:

```graphql giftcard

Authentication
mutation Auth($payload: JSON) {
  auth(payload: $payload) {
    response
    identifier
  }
}

query GetBalanceAndTxs($identifier: String) {
  account(identifier: $identifier) {
    id
    name
    balance
    currency
  }
  transaction(identifier: $identifier) {
      transactionId
      transactionTime
      amount
      currency
			description
      status
      balance
    }
  }

```

```mutation variables
{
	"payload": {
		"id": "62734010275110916",
		"pin": "2170"
	}
}

```

```query variables
{
	"identifier": "" (Get from mutation)
}

```

**Files to check**
- `everyday/everyday.ts` — main everyday script
- `everyday/everyday_api.ts` — GraphQL server implementation
- `everyday/package.json` — npm scripts and dependencies

### k6 Load / Integration Testing

You can use `k6_test.js` to perform load and integration testing on your GraphQL servers.

**Run the test with:**

```bash
k6\k6-v1.5.0-windows-amd64\k6.exe run .\k6_test.js
