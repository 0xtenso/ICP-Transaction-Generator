import { HttpAgent, Actor } from '@dfinity/agent';
import { Secp256k1KeyIdentity } from '@dfinity/identity-secp256k1';
import { Principal } from '@dfinity/principal';
import { createInterface } from 'readline/promises';
import { LedgerCanister, AccountIdentifier } from '@dfinity/ledger-icp';

export class ICPTransactionGenerator {
  constructor(network = 'mainnet') {
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
   * @param {string} privateKeyHex - Private key in hex format (64 characters for secp256k1)
   * @returns {Secp256k1KeyIdentity} Identity object
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

    console.log('Creating secp256k1 identity from private key');

    try {
      const identity = Secp256k1KeyIdentity.fromSecretKey(privateKeyBytes);
      console.log('Successfully created secp256k1 identity');
      return identity;
    } catch (error) {
      throw new Error(`Failed to create secp256k1 identity: ${error.message}`);
    }
  }

  /**
   * Validate and parse receiver address
   * @param {string} receiverAddress - AccountIdentifier or Principal
   * @returns {Object} Object with both Principal and AccountIdentifier for compatibility
   */
  parseReceiverAddress(receiverAddress) {
    if (!receiverAddress || typeof receiverAddress !== 'string') {
      throw new Error('Receiver address is required and must be a string');
    }

    const trimmedAddress = receiverAddress.trim();

    // Try Principal format first
    try {
      const principal = Principal.fromText(trimmedAddress);
      // Convert Principal to AccountIdentifier for legacy compatibility
      const accountIdentifier = AccountIdentifier.fromPrincipal({
        principal: principal,
        subAccount: undefined
      });
      
      return {
        principal: principal,
        accountIdentifier: accountIdentifier,
        type: 'principal'
      };
    } catch (principalError) {
      // Try AccountIdentifier format (64 hex characters)
      if (trimmedAddress.length === 64 && /^[0-9a-fA-F]+$/.test(trimmedAddress)) {
        try {
          const accountIdentifier = AccountIdentifier.fromHex(trimmedAddress);
          
          return {
            principal: null, // Cannot reliably convert AccountIdentifier back to Principal
            accountIdentifier: accountIdentifier,
            type: 'accountIdentifier'
          };
        } catch (accountError) {
          throw new Error(`Invalid AccountIdentifier format: ${accountError.message}`);
        }
      }
      
      throw new Error(`Invalid receiver address format. Expected Principal (e.g., "rdmx6-jaaaa-aaaaa-aaadq-cai") or AccountIdentifier (64 hex characters). Error: ${principalError.message}`);
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
   * @param {Secp256k1KeyIdentity} identity - Secp256k1 identity object
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
   * Create and send ICP transaction using LedgerCanister
   * @param {string} privateKeyHex - Sender's private key in hex
   * @param {string} receiverAddress - Receiver's Principal or AccountIdentifier
   * @param {number|string} amount - Amount to send in ICP
   * @param {string|number} memo - Optional memo (default: current timestamp)
   * @returns {Promise<Object>} Transaction result
   */
  async sendTransaction(privateKeyHex, receiverAddress, amount, memo = null) {
    console.log('Starting ICP transaction using LedgerCanister...');
    
    // Create identity and get accounts
    const senderIdentity = this.createIdentityFromPrivateKey(privateKeyHex);
    const senderAccountId = this.getAccountIdentifier(senderIdentity);
    const receiver = this.parseReceiverAddress(receiverAddress);
    
    console.log(`Sender: ${senderAccountId}`);
    console.log(`Receiver: ${receiver.principal ? receiver.principal.toString() : receiver.accountIdentifier.toHex()}`);
    console.log(`Receiver type: ${receiver.type}`);
    
    // Convert amount and validate
    const amountE8s = this.icpToE8s(amount);
    const transferFee = BigInt(10_000);
    const totalRequired = amountE8s + transferFee;
    
    console.log(`Amount: ${amount} ICP, Fee: 0.0001 ICP, Total: ${(Number(totalRequired) / 100_000_000)} ICP`);
    
    // Check balance if ledger is available
    if (this.ledger) {
      try {
        const senderBalance = await this.getBalance(senderAccountId);
        if (senderBalance < totalRequired) {
          throw new Error(
            `Insufficient balance. Required: ${totalRequired} e8s, Available: ${senderBalance} e8s`
          );
        }
        console.log(`✓ Balance check passed. Available: ${senderBalance} e8s`);
      } catch (error) {
        console.warn('Could not check balance, proceeding with transaction:', error.message);
      }
    }
    
    // Create authenticated agent with sender identity
    const agent = new HttpAgent({
      host: this.network === 'mainnet' ? 'https://ic0.app' : 'http://127.0.0.1:4943',
      identity: senderIdentity
    });
    
    if (this.network === 'local') {
      await agent.fetchRootKey();
    }
    
    // Create authenticated ledger canister
    const ledger = LedgerCanister.create({
      agent,
      canisterId: Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai') // ICP Ledger Canister ID
    });
    
    // Prepare memo - handle empty strings and null values
    let memoValue = BigInt(Date.now()); // Default to timestamp
    
    console.log('Processing memo input:', { memo, type: typeof memo, value: memo });
    
    try {
      if (memo !== null && memo !== undefined && memo !== '') {
        if (typeof memo === 'string') {
          const trimmedMemo = memo.trim();
          if (trimmedMemo !== '') {
            const numericMemo = parseInt(trimmedMemo, 10);
            if (!isNaN(numericMemo) && numericMemo >= 0) {
              memoValue = BigInt(numericMemo);
              console.log('Using custom memo:', memoValue.toString());
            } else {
              console.warn(`Invalid memo value "${memo}", using timestamp`);
            }
          }
        } else if (typeof memo === 'number' && memo >= 0 && Number.isInteger(memo)) {
          memoValue = BigInt(memo);
          console.log('Using numeric memo:', memoValue.toString());
        }
      } else {
        console.log('No memo provided, using timestamp:', memoValue.toString());
      }
    } catch (error) {
      console.warn(`Error processing memo: ${error.message}, using timestamp`);
      memoValue = BigInt(Date.now());
    }
    
    // Execute transfer using LedgerCanister
    console.log('Executing transfer with LedgerCanister...');
    
    // Prepare transfer arguments using LedgerCanister's expected format
    const transferArgs = {
      to: receiver.accountIdentifier,
      amount: Number(amountE8s),
      fee: Number(transferFee),
      memo: Number(memoValue),
      from_subaccount: null,
      created_at_time: null
    };
    
    console.log('Transfer arguments prepared:');
    console.log('- to (AccountIdentifier):', receiver.accountIdentifier.toHex());
    console.log('- amount (e8s):', Number(amountE8s), typeof Number(amountE8s));
    console.log('- fee (e8s):', Number(transferFee), typeof Number(transferFee));
    console.log('- memo:', Number(memoValue), typeof Number(memoValue));
    console.log('- from_subaccount:', transferArgs.from_subaccount);
    console.log('- created_at_time:', transferArgs.created_at_time);
    
    try {
      console.log('Calling ledger.transfer...');
      const transferResult = await ledger.transfer(transferArgs);
      
      console.log('Transfer result received:', transferResult, typeof transferResult);
      
      // Handle different response formats
      let blockIndex;
      let isSuccess = false;
      
      if (typeof transferResult === 'number' || typeof transferResult === 'bigint') {
        // Direct block index response (successful transfer)
        blockIndex = transferResult;
        isSuccess = true;
        console.log(`Transfer successful! Block index: ${blockIndex}`);
      } else if (transferResult && typeof transferResult === 'object') {
        // Result object with Ok/Err variants
        if ('Ok' in transferResult) {
          blockIndex = transferResult.Ok;
          isSuccess = true;
          console.log(`Transfer successful! Block index: ${blockIndex}`);
        } else if ('Err' in transferResult) {
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
        } else {
          throw new Error(`Unknown result format: ${JSON.stringify(transferResult)}`);
        }
      } else {
        throw new Error(`Unexpected result type: ${typeof transferResult}, value: ${transferResult}`);
      }
      
      if (isSuccess) {
        return {
          success: true,
          blockIndex: blockIndex.toString(),
          senderAccount: senderAccountId,
          receiverAccount: receiver.principal ? receiver.principal.toString() : receiver.accountIdentifier.toHex(),
          receiverType: receiver.type,
          amount: amount.toString(),
          amountE8s: amountE8s.toString(),
          fee: transferFee.toString(),
          memo: Number(memoValue).toString(),
          network: this.network,
          timestamp: new Date().toISOString(),
          transferType: 'LedgerCanister'
        };
      }
    } catch (error) {
      if (error.message && error.message.includes('Transfer failed')) {
        throw error; // Re-throw our formatted error
      } else {
        throw new Error(`LedgerCanister transfer error: ${error.message}`);
      }
    }
  }

  /**
   * Generate a new secp256k1 key pair
   * @returns {Object} Key pair with private and public keys
   */
  generateKeyPair() {
    const identity = Secp256k1KeyIdentity.generate();
    const keyPair = identity.getKeyPair();
    
    const privateKey = Array.from(keyPair.secretKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    let publicKey;
    try {
      // For secp256k1, get the public key from the identity
      const pubKey = identity.getPublicKey();
      publicKey = Array.from(pubKey.toDer())
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (error) {
      console.warn('Could not extract public key:', error.message);
      publicKey = '';
    }
    
    return {
      privateKey: `0x${privateKey}`,
      publicKey: `0x${publicKey}`,
      principal: identity.getPrincipal().toString(),
      accountIdentifier: this.getAccountIdentifier(identity),
      curve: 'secp256k1'
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
      const network = await rl.question('Network (local/mainnet) [mainnet]: ');
      let selectedNetwork = network.trim() || 'mainnet';
      
      // Initialize generator
      const generator = new ICPTransactionGenerator(selectedNetwork);
      console.log(`\nInitializing ${selectedNetwork} network...`);
      
      try {
        await generator.init();
        console.log('Connected successfully!');
      } catch (error) {
        if (selectedNetwork === 'local' && error.message.includes('Cannot connect to local IC environment')) {
          console.error(`\n${error.message}`);
          
          const switchToMainnet = await rl.question('\nWould you like to use mainnet instead? (y/n) [y]: ');
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
      
      const privateKey = await rl.question('Sender private key (hex): ');
      if (!privateKey.trim()) {
        throw new Error('Private key is required');
      }
      
      // Validate private key format
      const cleanPrivateKey = privateKey.trim().replace(/^0x/, '');
      if (cleanPrivateKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanPrivateKey)) {
        throw new Error('Private key must be 64 hex characters (32 bytes). Example: 6239bd6982d3869a7d11a540bcc68dbafa14943e6135ef3d8d73de503b04ae57');
      }
      
      console.log('✓ Using secp256k1 curve for all private keys');
      
      const receiverAddress = await rl.question('Receiver address: ');
      if (!receiverAddress.trim()) {
        throw new Error('Receiver address is required');
      }
      
      // Validate receiver address format
      const cleanReceiver = receiverAddress.trim();
      try {
        Principal.fromText(cleanReceiver);
        console.log('✓ Principal format detected');
      } catch (error) {
        if (cleanReceiver.length === 64 && /^[0-9a-fA-F]+$/.test(cleanReceiver)) {
          console.log('✓ AccountIdentifier format detected');
        } else {
          console.warn('⚠️  Receiver address format may be invalid. Expected: Principal (e.g., "rdmx6-jaaaa-aaaaa-aaadq-cai") or AccountIdentifier (64 hex characters)');
        }
      }
      
      const amount = await rl.question('Amount (ICP): ');
      if (!amount.trim()) {
        throw new Error('Amount is required');
      }
      
      // Validate amount
      const amountNum = parseFloat(amount.trim());
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Amount must be a positive number');
      }
      if (amountNum < 0.00000001) {
        throw new Error('Amount too small (minimum: 0.00000001 ICP)');
      }
      
      const memo = await rl.question('Memo (optional): ');
      
      // Validate memo if provided
      if (memo.trim() !== '') {
        const memoNum = parseInt(memo.trim(), 10);
        if (isNaN(memoNum) || memoNum < 0) {
          console.warn('Memo should be a positive integer, using timestamp instead');
        }
      }
      
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