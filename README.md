# ICP Transaction Generator

A Node.js library for generating and sending ICP (Internet Computer Protocol) transactions using private keys.

## Features

- ✅ Send ICP transactions using private keys
- ✅ Support for both local and mainnet networks
- ✅ Generate new Ed25519 key pairs
- ✅ Check account balances
- ✅ Cross-platform compatibility
- ✅ Comprehensive error handling
- ✅ Supports both AccountIdentifier and Principal addresses

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd ICP-Transaction-Generator
```

2. Install dependencies:
```bash
npm install
```

## Quick Start

### Running the Example

```bash
node transaction-generator.js
```

This will generate example key pairs and show you how to use the library.

### Basic Usage

```javascript
import ICPTransactionGenerator from './transaction-generator.js';

// Create a new transaction generator
const generator = new ICPTransactionGenerator('local'); // or 'mainnet'

// Initialize the connection
await generator.init();

// Send a transaction
const result = await generator.sendTransaction(
  '0x1234567890abcdef...', // sender's private key (64 hex chars)
  'receiver-account-id-or-principal', // receiver's address
  '1.0', // amount in ICP
  '12345' // memo (optional)
);

console.log('Transaction successful:', result);
```

## API Reference

### Constructor

```javascript
new ICPTransactionGenerator(network)
```

- `network` (string): Either `'local'` or `'mainnet'`

### Methods

#### `async init()`

Initialize the agent and ledger connection. Must be called before other operations.

#### `async sendTransaction(privateKeyHex, receiverAddress, amount, memo?)`

Send an ICP transaction.

**Parameters:**
- `privateKeyHex` (string): Sender's private key in hex format (64 characters)
- `receiverAddress` (string): Receiver's AccountIdentifier (64 hex chars) or Principal
- `amount` (number|string): Amount to send in ICP
- `memo` (string|number, optional): Transaction memo

**Returns:** Promise<TransactionResult>

**Example:**
```javascript
const result = await generator.sendTransaction(
  '0xabcdef1234567890...',
  'af58f8c252e5070f7525d41aaca49c420a94949ce258fc85bd6ec5314e1c',
  '0.5',
  '12345'
);
```

#### `generateKeyPair()`

Generate a new Ed25519 key pair.

**Returns:**
```javascript
{
  privateKey: '0x...',
  publicKey: '0x...',
  principal: 'principal-id',
  accountIdentifier: 'account-id'
}
```

#### `async getBalance(accountIdentifier)`

Get the balance of an account.

**Parameters:**
- `accountIdentifier` (string): Account identifier in hex format

**Returns:** Promise<bigint> - Balance in e8s (1 ICP = 100,000,000 e8s)

#### `parseReceiverAddress(address)`

Parse and validate a receiver address.

**Parameters:**
- `address` (string): AccountIdentifier or Principal

**Returns:** AccountIdentifier object

#### `getAccountIdentifier(identity)`

Get account identifier from an identity.

**Parameters:**
- `identity` (Ed25519KeyIdentity): Identity object

**Returns:** string - Account identifier in hex format

## Address Formats

The transaction generator supports two address formats:

1. **AccountIdentifier** (64 hex characters):
   ```
   af58f8c252e5070f7525d41aaca49c420a94949ce258fc85bd6ec5314e1c
   ```

2. **Principal** (text format):
   ```
   rdmx6-jaaaa-aaaaa-aaadq-cai
   ```

## Network Configuration

### Local Network

For local development, you need to have a local ICP ledger running:

```bash
# Deploy local ICP ledger (example with dfx)
dfx deploy --specified-id ryjl3-tyaaa-aaaaa-aaaba-cai icp_ledger_canister
```

### Mainnet

For mainnet transactions, use:

```javascript
const generator = new ICPTransactionGenerator('mainnet');
```

## Transaction Fees

- Standard transfer fee: **0.0001 ICP** (10,000 e8s)
- Minimum transaction amount: **0.00000001 ICP** (1 e8s)

## Examples

### Example 1: Simple Transaction

```javascript
import ICPTransactionGenerator from './transaction-generator.js';

async function sendSimpleTransaction() {
  const generator = new ICPTransactionGenerator('local');
  await generator.init();
  
  try {
    const result = await generator.sendTransaction(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'af58f8c252e5070f7525d41aaca49c420a94949ce258fc85bd6ec5314e1c',
      '1.0'
    );
    
    console.log('Success! Block index:', result.blockIndex);
  } catch (error) {
    console.error('Transaction failed:', error.message);
  }
}
```

### Example 2: Generate Keys and Check Balance

```javascript
async function generateAndCheck() {
  const generator = new ICPTransactionGenerator('local');
  await generator.init();
  
  // Generate new key pair
  const keys = generator.generateKeyPair();
  console.log('New account:', keys.accountIdentifier);
  
  // Check balance
  const balance = await generator.getBalance(keys.accountIdentifier);
  console.log('Balance:', balance.toString(), 'e8s');
}
```

### Example 3: Error Handling

```javascript
async function handleErrors() {
  const generator = new ICPTransactionGenerator('local');
  await generator.init();
  
  try {
    await generator.sendTransaction(
      'invalid-private-key',
      'invalid-address',
      'invalid-amount'
    );
  } catch (error) {
    if (error.message.includes('Invalid private key')) {
      console.log('Private key format is wrong');
    } else if (error.message.includes('Invalid receiver address')) {
      console.log('Receiver address format is wrong');
    } else if (error.message.includes('Insufficient balance')) {
      console.log('Not enough funds in sender account');
    } else {
      console.log('Other error:', error.message);
    }
  }
}
```

## Private Key Format

Private keys must be:
- 64 hexadecimal characters (32 bytes)
- Ed25519 format
- Can include or omit the '0x' prefix

**Valid formats:**
```
0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

## Security Considerations

⚠️ **Important Security Notes:**

1. **Never hardcode private keys** in your source code
2. **Never commit private keys** to version control
3. **Use environment variables** for private keys in production
4. **Test with small amounts** first
5. **Validate all inputs** before processing
6. **Use proper key management** for production applications

## Error Handling

The library provides detailed error messages for common issues:

- `Invalid private key: Private key must be 64 hex characters (32 bytes)`
- `Invalid receiver address: Invalid receiver address format`
- `Insufficient balance. Required: X e8s, Available: Y e8s`
- `Transfer failed: Bad fee. Expected: X`
- `Ledger not initialized. Call init() first.`

## Troubleshooting

### Common Issues

1. **"Ledger not initialized"**
   - Make sure to call `await generator.init()` before other operations

2. **"Connection refused"**
   - For local network: Ensure your local ICP ledger is running
   - For mainnet: Check your internet connection

3. **"Insufficient balance"**
   - Make sure the sender account has enough ICP + fees
   - Remember: 1 ICP = 100,000,000 e8s

4. **"Invalid private key"**
   - Ensure private key is exactly 64 hex characters
   - Check for typos or missing characters

## Dependencies

- `@dfinity/agent`: ICP agent for blockchain communication
- `@dfinity/identity`: Identity management for Ed25519 keys
- `@dfinity/principal`: Principal handling
- `@dfinity/ledger-icp`: ICP ledger integration

## License

MIT License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
- Create an issue in this repository
- Check the [Internet Computer documentation](https://internetcomputer.org/docs/)
- Visit the [ICP Developer Forum](https://forum.dfinity.org/)