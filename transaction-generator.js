import { HttpAgent } from '@dfinity/agent';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import { Principal } from '@dfinity/principal';
import ledgerPkg from '@dfinity/ledger-icp';
const { AccountIdentifier, LedgerCanister } = ledgerPkg;

/**
 * ICP Transaction Generator
 * Creates and sends ICP transactions using private keys
 */
export class ICPTransactionGenerator {
  constructor(network = 'local') {
    this.network = network;
    this.agent = null;
    this.ledger = null;
  }

  /**
   * Initialize the agent and ledger connection
   */
  async init() {
    const host = this.network === 'mainnet' 
      ? 'https://ic0.app' 
      : 'http://127.0.0.1:4943';

    this.agent = new HttpAgent({ host });
    
    // Only fetch root key for local development
    if (this.network === 'local') {
      await this.agent.fetchRootKey();
    }

    // ICP Ledger canister ID (same for mainnet and local when deployed with same ID)
    const ledgerCanisterId = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
    
    this.ledger = LedgerCanister.create({
      agent: this.agent,
      canisterId: ledgerCanisterId
    });
  }

  /**
   * Create identity from private key
   * @param {string} privateKeyHex - Private key in hex format (64 characters)
   * @returns {Ed25519KeyIdentity} Identity object
   */
  createIdentityFromPrivateKey(privateKeyHex) {
    try {
      // Remove '0x' prefix if present
      const cleanHex = privateKeyHex.replace(/^0x/, '');
      
      // Validate hex string length (Ed25519 private key should be 64 hex characters)
      if (cleanHex.length !== 64) {
        throw new Error('Private key must be 64 hex characters (32 bytes)');
      }

      // Convert hex to Uint8Array
      const privateKeyBytes = new Uint8Array(
        cleanHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );

      // Create identity from private key
      return Ed25519KeyIdentity.fromSecretKey(privateKeyBytes);
    } catch (error) {
      throw new Error(`Invalid private key: ${error.message}`);
    }
  }

  /**
   * Validate and parse receiver address
   * @param {string} receiverAddress - AccountIdentifier or Principal
   * @returns {AccountIdentifier} Validated account identifier
   */
  parseReceiverAddress(receiverAddress) {
    try {
      // Try to parse as AccountIdentifier first
      if (receiverAddress.length === 64) {
        return AccountIdentifier.fromHex(receiverAddress);
      }
      
      // Try to parse as Principal and convert to AccountIdentifier
      const principal = Principal.fromText(receiverAddress);
      return AccountIdentifier.fromPrincipal({
        principal: principal,
        subAccount: undefined
      });
    } catch (error) {
      throw new Error(`Invalid receiver address: ${error.message}`);
    }
  }

  /**
   * Convert ICP amount to e8s (smallest unit)
   * @param {number|string} amount - Amount in ICP
   * @returns {bigint} Amount in e8s
   */
  icpToE8s(amount) {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Amount must be a positive number');
    }
    
    // 1 ICP = 100,000,000 e8s
    return BigInt(Math.floor(amountNum * 100_000_000));
  }

  /**
   * Get account balance
   * @param {string} accountIdentifier - Account identifier hex string
   * @returns {Promise<bigint>} Balance in e8s
   */
  async getBalance(accountIdentifier) {
    try {
      const account = AccountIdentifier.fromHex(accountIdentifier);
      const balance = await this.ledger.accountBalance({ account });
      return balance;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Get account identifier from identity
   * @param {Ed25519KeyIdentity} identity - Identity object
   * @returns {string} Account identifier hex string
   */
  getAccountIdentifier(identity) {
    const principal = identity.getPrincipal();
    const accountId = AccountIdentifier.fromPrincipal({
      principal: principal,
      subAccount: undefined
    });
    return accountId.toHex();
  }

  /**
   * Create and send ICP transaction
   * @param {string} privateKeyHex - Sender's private key in hex
   * @param {string} receiverAddress - Receiver's address (AccountIdentifier or Principal)
   * @param {number|string} amount - Amount to send in ICP
   * @param {string} memo - Optional memo (default: current timestamp)
   * @returns {Promise<Object>} Transaction result
   */
  async sendTransaction(privateKeyHex, receiverAddress, amount, memo = null) {
    try {
      console.log('Starting ICP transaction...');
      
      // 1. Create identity from private key
      const senderIdentity = this.createIdentityFromPrivateKey(privateKeyHex);
      const senderAccountId = this.getAccountIdentifier(senderIdentity);
      console.log(`Sender Account: ${senderAccountId}`);
      
      // 2. Parse receiver address
      const receiverAccountId = this.parseReceiverAddress(receiverAddress);
      console.log(`Receiver Account: ${receiverAccountId.toHex()}`);
      
      // 3. Convert amount to e8s
      const amountE8s = this.icpToE8s(amount);
      console.log(`Amount: ${amount} ICP (${amountE8s} e8s)`);
      
      // 4. Check sender balance
      const senderBalance = await this.getBalance(senderAccountId);
      const transferFee = BigInt(10_000); // Standard transfer fee: 0.0001 ICP
      const totalRequired = amountE8s + transferFee;
      
      console.log(`Sender Balance: ${senderBalance} e8s`);
      console.log(`Transfer Fee: ${transferFee} e8s`);
      console.log(`Total Required: ${totalRequired} e8s`);
      
      if (senderBalance < totalRequired) {
        throw new Error(
          `Insufficient balance. Required: ${totalRequired} e8s, Available: ${senderBalance} e8s`
        );
      }
      
      // 5. Create agent with sender identity
      const authenticatedAgent = new HttpAgent({
        host: this.network === 'mainnet' ? 'https://ic0.app' : 'http://127.0.0.1:4943',
        identity: senderIdentity
      });
      
      if (this.network === 'local') {
        await authenticatedAgent.fetchRootKey();
      }
      
      // 6. Create authenticated ledger instance
      const authenticatedLedger = LedgerCanister.create({
        agent: authenticatedAgent,
        canisterId: Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai')
      });
      
      // 7. Prepare transfer parameters
      const transferParams = {
        to: receiverAccountId,
        amount: amountE8s,
        fee: transferFee,
        memo: memo ? BigInt(memo) : BigInt(Date.now()),
        fromSubaccount: undefined, // Use default subaccount
        createdAtTime: undefined  // Use current time
      };
      
      console.log('Transfer Parameters:', {
        to: transferParams.to.toHex(),
        amount: transferParams.amount.toString(),
        fee: transferParams.fee.toString(),
        memo: transferParams.memo.toString()
      });
      
      // 8. Execute transfer
      console.log('Executing transfer...');
      const transferResult = await authenticatedLedger.transfer(transferParams);
      
      // 9. Handle result
      if ('Ok' in transferResult) {
        const blockIndex = transferResult.Ok;
        console.log('Transaction successful!');
        console.log(`Block Index: ${blockIndex}`);
        
        return {
          success: true,
          blockIndex: blockIndex.toString(),
          transactionHash: blockIndex.toString(),
          senderAccount: senderAccountId,
          receiverAccount: receiverAccountId.toHex(),
          amount: amount,
          amountE8s: amountE8s.toString(),
          fee: transferFee.toString(),
          memo: transferParams.memo.toString(),
          network: this.network
        };
      } else {
        // Handle transfer errors
        const error = transferResult.Err;
        let errorMessage = 'Transfer failed: ';
        
        if ('BadFee' in error) {
          errorMessage += `Bad fee. Expected: ${error.BadFee.expected_fee}`;
        } else if ('InsufficientFunds' in error) {
          errorMessage += `Insufficient funds. Balance: ${error.InsufficientFunds.balance}`;
        } else if ('TxTooOld' in error) {
          errorMessage += 'Transaction too old';
        } else if ('TxCreatedInFuture' in error) {
          errorMessage += 'Transaction created in future';
        } else if ('TxDuplicate' in error) {
          errorMessage += `Duplicate transaction. Block: ${error.TxDuplicate.duplicate_of}`;
        } else {
          errorMessage += JSON.stringify(error);
        }
        
        throw new Error(errorMessage);
      }
      
    } catch (error) {
      console.error('Transaction failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate a new Ed25519 key pair
   * @returns {Object} Key pair with private and public keys
   */
  generateKeyPair() {
    const identity = Ed25519KeyIdentity.generate();
    const privateKey = Array.from(identity.getKeyPair().secretKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const publicKey = Array.from(identity.getKeyPair().publicKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const principal = identity.getPrincipal().toString();
    const accountId = this.getAccountIdentifier(identity);
    
    return {
      privateKey: `0x${privateKey}`,
      publicKey: `0x${publicKey}`,
      principal,
      accountIdentifier: accountId
    };
  }
}

// Example usage - you can run this file directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  async function example() {
    try {
      console.log('ICP Transaction Generator Example');
      
      // Generate example keypairs
      const generator = new ICPTransactionGenerator('local');
      await generator.init();
      
      console.log('Generating test keypairs...\n');
      
      const senderKeys = generator.generateKeyPair();
      const receiverKeys = generator.generateKeyPair();
      
      console.log('Sender:');
      console.log(`Private Key: ${senderKeys.privateKey}`);
      console.log(`Account ID: ${senderKeys.accountIdentifier}\n`);
      
      console.log('Receiver:');
      console.log(`Account ID: ${receiverKeys.accountIdentifier}\n`);
      
      console.log('To send a transaction, use:');
      console.log('```javascript');
      console.log('const generator = new ICPTransactionGenerator("local");');
      console.log('await generator.init();');
      console.log('');
      console.log('const result = await generator.sendTransaction(');
      console.log(`  "${senderKeys.privateKey}",  // sender private key`);
      console.log(`  "${receiverKeys.accountIdentifier}",  // receiver address`);
      console.log('  "1.0",  // amount in ICP');
      console.log('  "12345"  // memo (optional)');
      console.log(');');
      console.log('```\n');
      
      console.log('Note: Make sure you have a local ICP ledger running with funds in the sender account!');
      
    } catch (error) {
      console.error('Example failed:', error.message);
    }
  }
  
  example();
}

// Export for use in other modules
export default ICPTransactionGenerator;