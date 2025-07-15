import { HttpAgent } from '@dfinity/agent';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import { Principal } from '@dfinity/principal';
import { createInterface } from 'readline/promises';
import ledgerPkg from '@dfinity/ledger-icp';
const { AccountIdentifier, LedgerCanister } = ledgerPkg;

export class ICPTransactionGenerator {
  constructor(network = 'local') {
    this.network = network;
    this.agent = null;
    this.ledger = null;
  }

  async init() {
    try {
      const host = this.network === 'mainnet' 
        ? 'https://ic0.app' 
        : 'http://127.0.0.1:4943';

      this.agent = new HttpAgent({ host });
      
      if (this.network === 'local') {
        await this.agent.fetchRootKey();
      }

      const ledgerCanisterId = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
      
      this.ledger = LedgerCanister.create({
        agent: this.agent,
        canisterId: ledgerCanisterId
      });

    } catch (error) {
      if (this.network === 'local' && (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED'))) {
        throw new Error(
          `Cannot connect to local IC environment. Please ensure the local IC environment is running:\n\n` +
          `1. Install dfx: sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"\n` +
          `2. Start local environment: dfx start --clean --background\n` +
          `3. Deploy ICP ledger: dfx ledger fabricate-cycles --icp 1000\n\n` +
          `Or use 'mainnet' network instead.`
        );
      }
      throw new Error(`Failed to initialize ICP agent: ${error.message}`);
    }
  }

  /**
   * @param {string} privateKeyHex - Private key in hex format (64 characters)
   * @returns {Ed25519KeyIdentity} Identity object
   */
  createIdentityFromPrivateKey(privateKeyHex) {
    if (!privateKeyHex || typeof privateKeyHex !== 'string') {
      throw new Error('Private key is required and must be a string');
    }

    const cleanHex = privateKeyHex.replace(/^0x/, '');
    
    if (cleanHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanHex)) {
      throw new Error('Private key must be 64 hex characters (32 bytes)');
    }

    const privateKeyBytes = new Uint8Array(
      cleanHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );

    return Ed25519KeyIdentity.fromSecretKey(privateKeyBytes);
  }

  /**
   * Validate and parse receiver address
   * @param {string} receiverAddress - AccountIdentifier or Principal
   * @returns {AccountIdentifier} Validated account identifier
   */
  parseReceiverAddress(receiverAddress) {
    if (!receiverAddress || typeof receiverAddress !== 'string') {
      throw new Error('Receiver address is required and must be a string');
    }

    const trimmedAddress = receiverAddress.trim();

    // Try AccountIdentifier format (64 hex characters)
    if (trimmedAddress.length === 64 && /^[0-9a-fA-F]+$/.test(trimmedAddress)) {
      return AccountIdentifier.fromHex(trimmedAddress);
    }
    
    // Try Principal format
    const principal = Principal.fromText(trimmedAddress);
    return AccountIdentifier.fromPrincipal({
      principal: principal,
      subAccount: undefined
    });
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
    
    if (amountNum < 0.00000001) {
      throw new Error('Amount too small (minimum: 0.00000001 ICP)');
    }
    
    return BigInt(Math.floor(amountNum * 100_000_000));
  }

  /**
   * Get account balance
   * @param {string} accountIdentifier - Account identifier hex string
   * @returns {Promise<bigint>} Balance in e8s
   */
  async getBalance(accountIdentifier) {
    if (!this.ledger) {
      throw new Error('Ledger not initialized. Call init() first.');
    }

    const account = AccountIdentifier.fromHex(accountIdentifier);
    return await this.ledger.accountBalance({ account });
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
   * @param {string|number} memo - Optional memo (default: current timestamp)
   * @returns {Promise<Object>} Transaction result
   */
  async sendTransaction(privateKeyHex, receiverAddress, amount, memo = null) {
    if (!this.ledger) {
      throw new Error('Ledger not initialized. Call init() first.');
    }

    console.log('Starting ICP transaction...');
    
    // Create identity and get accounts
    const senderIdentity = this.createIdentityFromPrivateKey(privateKeyHex);
    const senderAccountId = this.getAccountIdentifier(senderIdentity);
    const receiverAccountId = this.parseReceiverAddress(receiverAddress);
    
    console.log(`Sender: ${senderAccountId}`);
    console.log(`Receiver: ${receiverAccountId.toHex()}`);
    
    // Convert amount and check balance
    const amountE8s = this.icpToE8s(amount);
    const transferFee = BigInt(10_000);
    const totalRequired = amountE8s + transferFee;
    
    const senderBalance = await this.getBalance(senderAccountId);
    console.log(`Amount: ${amount} ICP, Fee: 0.0001 ICP, Total: ${(Number(totalRequired) / 100_000_000)} ICP`);
    
    if (senderBalance < totalRequired) {
      throw new Error(
        `Insufficient balance. Required: ${totalRequired} e8s, Available: ${senderBalance} e8s`
      );
    }
    
    // Create authenticated agent and ledger
    const authenticatedAgent = new HttpAgent({
      host: this.network === 'mainnet' ? 'https://ic0.app' : 'http://127.0.0.1:4943',
      identity: senderIdentity
    });
    
    if (this.network === 'local') {
      await authenticatedAgent.fetchRootKey();
    }
    
    const authenticatedLedger = LedgerCanister.create({
      agent: authenticatedAgent,
      canisterId: Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai')
    });
    
    // Execute transfer
    const transferParams = {
      to: receiverAccountId,
      amount: amountE8s,
      fee: transferFee,
      memo: memo ? BigInt(memo) : BigInt(Date.now()),
      fromSubaccount: undefined,
      createdAtTime: undefined
    };
    
    console.log('Executing transfer...');
    const transferResult = await authenticatedLedger.transfer(transferParams);
    
    if ('Ok' in transferResult) {
      const blockIndex = transferResult.Ok;
      console.log(`Transaction successful! Block: ${blockIndex}`);
      
      return {
        success: true,
        blockIndex: blockIndex.toString(),
        senderAccount: senderAccountId,
        receiverAccount: receiverAccountId.toHex(),
        amount: amount.toString(),
        amountE8s: amountE8s.toString(),
        fee: transferFee.toString(),
        memo: transferParams.memo.toString(),
        network: this.network,
        timestamp: new Date().toISOString()
      };
    } else {
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
  }

  /**
   * Generate a new Ed25519 key pair
   * @returns {Object} Key pair with private and public keys
   */
  generateKeyPair() {
    const identity = Ed25519KeyIdentity.generate();
    const keyPair = identity.getKeyPair();
    
    const privateKey = Array.from(keyPair.secretKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const publicKey = Array.from(keyPair.publicKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return {
      privateKey: `0x${privateKey}`,
      publicKey: `0x${publicKey}`,
      principal: identity.getPrincipal().toString(),
      accountIdentifier: this.getAccountIdentifier(identity)
    };
  }
}

// CLI interface when run directly
if (process.argv[1]?.endsWith('transaction-generator.js') || 
    new URL(import.meta.url).pathname === process.argv[1]) {
  
  async function promptForPassword(question) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    
    return new Promise((resolve) => {
      let password = '';
      process.stdin.on('data', function handler(char) {
        char = char.toString();
        
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', handler);
            process.stdout.write('\n');
            rl.close();
            resolve(password);
            break;
          case '\u0003':
            process.exit();
            break;
          case '\u007f':
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      });
    });
  }
  
  async function main() {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    try {
      console.log('ICP Transaction Generator');
      
      // Get network choice
      const network = await rl.question('Network (local/mainnet) [local]: ');
      let selectedNetwork = network.trim() || 'local';
      
      // Initialize generator
      const generator = new ICPTransactionGenerator(selectedNetwork);
      console.log(`\nInitializing ${selectedNetwork} network...`);
      
      try {
        await generator.init();
        console.log('Connected successfully!');
      } catch (error) {
        if (selectedNetwork === 'local' && error.message.includes('Cannot connect to local IC environment')) {
          console.error(`\n${error.message}`);
          
          const switchToMainnet = await rl.question('\nWould you like to use mainnet instead? (y/n) [n]: ');
          if (switchToMainnet.toLowerCase().trim() === 'y' || switchToMainnet.toLowerCase().trim() === 'yes') {
            selectedNetwork = 'mainnet';
            generator.network = 'mainnet';
            console.log('\nSwitching to mainnet...');
            await generator.init();
            console.log('Connected to mainnet successfully!');
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
      
      // Get transaction details
      console.log('\nEnter transaction details:');
      
      const privateKey = await promptForPassword('Sender private key (hex): ');
      if (!privateKey.trim()) {
        throw new Error('Private key is required');
      }
      
      const receiverAddress = await rl.question('Receiver address: ');
      if (!receiverAddress.trim()) {
        throw new Error('Receiver address is required');
      }
      
      const amount = await rl.question('Amount (ICP): ');
      if (!amount.trim()) {
        throw new Error('Amount is required');
      }
      
      const memo = await rl.question('Memo (optional): ');
      
      // Execute transaction
      console.log('\nProcessing transaction...');
      const result = await generator.sendTransaction(
        privateKey.trim(),
        receiverAddress.trim(),
        amount.trim(),
        memo.trim() || null
      );
      
      // Show results
      console.log('\nTransaction Summary:');
      console.log(`Status: SUCCESS`);
      console.log(`Block Index: ${result.blockIndex}`);
      console.log(`From: ${result.senderAccount}`);
      console.log(`To: ${result.receiverAccount}`);
      console.log(`Amount: ${result.amount} ICP`);
      console.log(`Fee: 0.0001 ICP`);
      console.log(`Network: ${result.network}`);
      console.log(`Time: ${result.timestamp}`);
      
    } catch (error) {
      console.error(`\nError: ${error.message}`);
      process.exit(1);
    } finally {
      rl.close();
    }
  }
  
  main();
}

export default ICPTransactionGenerator;