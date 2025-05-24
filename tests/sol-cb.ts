import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  createMint,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { expect } from "chai";
import { SolCb } from "../target/types/sol_cb";

// Add these helper functions at the top of the test file
async function airdropSol(
  connection: anchor.web3.Connection,
  address: PublicKey
) {
  const signature = await connection.requestAirdrop(
    address,
    10 * anchor.web3.LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(signature);
  console.log(`Airdropped 10 SOL to ${address.toString()}`);
}

async function setupTokenAccount(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount?: number
) {
  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );
  if (amount) {
    await mintTo(
      connection,
      payer,
      mint,
      account.address,
      payer, // mint authority
      amount
    );
    console.log(`Minted ${amount} tokens to ${owner.toString()}`);
  }
  return account.address;
}

describe("sol-cb", () => {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolCb as Program<SolCb>;

  // Key participants using provided private key for owner
  const ownerPrivateKey = bs58.decode(
    "2nDAt6Hgnx7AqDhbLTUaAKMxWGTmVfVva2ogA3GZxzYNkx3Dfhv2hqdpaY8X5j4BYcidLgW2y715eJQnLctxavjy"
  );
  const kolPrivateKey = bs58.decode(
    "dMXJ6CjSx16RVQezfPFN6AQcTkncZUK1z4BNZV2h17VEwEpaspQoQsETMCvdDxfnFfowPgYhUfQZLMKBGQxPcpk"
  );
  const creatorPrivateKey = bs58.decode(
    "2qdvq7j7TAQin1sesq2K8tFsRne6RfJ5hYQWSFyRDrkuBPgGHCX7LYZLqoW2gr8BpETzEvjxdndmwwM14BPUSdf"
  );
  const owner = Keypair.fromSecretKey(ownerPrivateKey);
  const creator = Keypair.fromSecretKey(creatorPrivateKey);
  const kol = Keypair.fromSecretKey(kolPrivateKey);

  // Program PDAs and variables
  let marketplacePda: PublicKey;
  let campaignPda: PublicKey;
  let campaignTokenAccount: PublicKey;
  let campaignCounter = 0;
  let tokenMint: PublicKey;

  // Add variables for open campaigns
  let openCampaignPda1: PublicKey;
  let openCampaignPda2: PublicKey;
  let openCampaignTokenAccount1: PublicKey;
  let openCampaignTokenAccount2: PublicKey;

  // Token accounts
  let creatorTokenAccount: PublicKey;
  let kolTokenAccount: PublicKey;
  let ownerTokenAccount: PublicKey;

  // Campaign constants
  const OFFERING_AMOUNT = new BN(1_000_000); // 1 token with 6 decimals
  const TRANSFER_AMOUNT = 10_000_000; // 10 tokens with 6 decimals
  const TOKEN_DECIMALS = 6;

  // Add these constants at the top with other constants
  const ALLOWED_TOKENS = [
    new PublicKey("D3Z5GzWh2E5Sh22nPzV6ambwFd8abfjp4kcqAJyeNoRg"),
  ];

  // Token-related variables
  let tokenMint1: PublicKey; // 6 decimals token
  let tokenMint2: PublicKey; // 9 decimals token

  // Token accounts for first token (6 decimals)
  let creatorTokenAccount1: PublicKey;
  let kolTokenAccount1: PublicKey;
  let ownerTokenAccount1: PublicKey;
  let campaignTokenAccount1: PublicKey;

  // Token accounts for second token (9 decimals)
  let creatorTokenAccount2: PublicKey;
  let kolTokenAccount2: PublicKey;
  let ownerTokenAccount2: PublicKey;
  let campaignTokenAccount2: PublicKey;

  // Campaign constants
  const TOKEN1_DECIMALS = 6;
  const TOKEN2_DECIMALS = 9;
  const OFFERING_AMOUNT1 = new BN(1_000_000); // 1 token with 6 decimals
  const OFFERING_AMOUNT2 = new BN(1_000_000_000); // 1 token with 9 decimals
  const TRANSFER_AMOUNT1 = 10_000_000; // 10 tokens with 6 decimals
  const TRANSFER_AMOUNT2 = 10_000_000_000; // 10 tokens with 9 decimals

  let campaignPda1: PublicKey;
  let campaignPda2: PublicKey;

  // Helper function to log campaign details
  const logCampaignInfo = async (pda: PublicKey, label: string) => {
    const campaign = await program.account.campaign.fetch(pda);
    console.log(`\n--- ${label} ---`);
    console.log(`Campaign ID: ${Buffer.from(campaign.id).toString("hex")}`);
    console.log(`Counter: ${campaign.counter}`);
    console.log(`Creator: ${campaign.creatorAddress.toString()}`);
    console.log(`Token Mint: ${campaign.tokenMint.toString()}`);
    console.log(`Selected KOL: ${campaign.selectedKol.toString()}`);
    console.log(`Amount offered: ${campaign.amountOffered.toString()}`);
    console.log(`Offer ends in: ${campaign.offerEndsIn.toString()}`);
    console.log(`Promotion ends in: ${campaign.promotionEndsIn.toString()}`);
    console.log(`Status: ${Object.keys(campaign.campaignStatus)[0]}`);
    console.log("-------------------------\n");
    return campaign;
  };

  // Add this helper function after the existing logCampaignInfo function
  const logOpenCampaignInfo = async (pda: PublicKey, label: string) => {
    const campaign = await program.account.openCampaign.fetch(pda);
    console.log(`\n--- ${label} ---`);
    console.log(`Campaign ID: ${Buffer.from(campaign.id).toString("hex")}`);
    console.log(`Counter: ${campaign.counter}`);
    console.log(`Creator: ${campaign.creatorAddress.toString()}`);
    console.log(`Token Mint: ${campaign.tokenMint.toString()}`);
    console.log(`Pool Amount: ${campaign.poolAmount.toString()}`);
    console.log(`Promotion ends in: ${campaign.promotionEndsIn.toString()}`);
    console.log(`Status: ${Object.keys(campaign.campaignStatus)[0]}`);
    console.log("-------------------------\n");
    return campaign;
  };

  // Helper function to log token balances
  const logTokenBalances = async (label: string) => {
    console.log(`\n--- Token Balances: ${label} ---`);
    try {
      const creatorBalance = await provider.connection.getTokenAccountBalance(
        creatorTokenAccount
      );
      console.log(`Creator token balance: ${creatorBalance.value.amount}`);
    } catch (e) {
      console.log(`Creator token account not found or has no balance`);
    }

    try {
      const campaignBalance = await provider.connection.getTokenAccountBalance(
        campaignTokenAccount
      );
      console.log(`Campaign token balance: ${campaignBalance.value.amount}`);
    } catch (e) {
      console.log(`Campaign token account not found or has no balance`);
    }

    try {
      const kolBalance = await provider.connection.getTokenAccountBalance(
        kolTokenAccount
      );
      console.log(`KOL token balance: ${kolBalance.value.amount}`);
    } catch (e) {
      console.log(`KOL token account not found or has no balance`);
    }

    try {
      const ownerBalance = await provider.connection.getTokenAccountBalance(
        ownerTokenAccount
      );
      console.log(`Owner token balance: ${ownerBalance.value.amount}`);
    } catch (e) {
      console.log(`Owner token account not found or has no balance`);
    }
    console.log("-------------------------\n");
  };

  before(async () => {
    // Airdrop SOL to all participants
    await airdropSol(provider.connection, owner.publicKey);
    await airdropSol(provider.connection, creator.publicKey);
    await airdropSol(provider.connection, kol.publicKey);

    // Create token mints
    console.log("Creating token mints...");
    const mintKeypair1 = Keypair.generate();
    const mintKeypair2 = Keypair.generate();

    // Create first token (6 decimals)
    tokenMint1 = await createMint(
      provider.connection,
      provider.wallet.payer,
      owner.publicKey,
      owner.publicKey,
      TOKEN1_DECIMALS,
      mintKeypair1
    );
    console.log("Token1 (6 decimals) created:", tokenMint1.toString());

    // Create second token (9 decimals)
    tokenMint2 = await createMint(
      provider.connection,
      provider.wallet.payer,
      owner.publicKey,
      owner.publicKey,
      TOKEN2_DECIMALS,
      mintKeypair2
    );
    console.log("Token2 (9 decimals) created:", tokenMint2.toString());

    // Setup token accounts for first token
    ownerTokenAccount1 = await setupTokenAccount(
      provider.connection,
      owner,
      tokenMint1,
      owner.publicKey,
      TRANSFER_AMOUNT1 * 4
    );

    creatorTokenAccount1 = await setupTokenAccount(
      provider.connection,
      owner,
      tokenMint1,
      creator.publicKey
    );

    kolTokenAccount1 = await setupTokenAccount(
      provider.connection,
      owner,
      tokenMint1,
      kol.publicKey
    );

    // Setup token accounts for second token
    ownerTokenAccount2 = await setupTokenAccount(
      provider.connection,
      owner,
      tokenMint2,
      owner.publicKey,
      TRANSFER_AMOUNT2 * 4
    );

    creatorTokenAccount2 = await setupTokenAccount(
      provider.connection,
      owner,
      tokenMint2,
      creator.publicKey
    );

    kolTokenAccount2 = await setupTokenAccount(
      provider.connection,
      owner,
      tokenMint2,
      kol.publicKey
    );

    // Calculate marketplace PDA
    [marketplacePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    console.log("Setup complete!");
  });

  it("1. Initialize Marketplace with Both Tokens", async () => {
    console.log("Test Case: Initialize Marketplace with Both Tokens");

    try {
      // Create token accounts first
      ownerTokenAccount1 = await setupTokenAccount(
        provider.connection,
        owner,
        tokenMint1,
        owner.publicKey,
        TRANSFER_AMOUNT1 * 4
      );

      ownerTokenAccount2 = await setupTokenAccount(
        provider.connection,
        owner,
        tokenMint2,
        owner.publicKey,
        TRANSFER_AMOUNT2 * 4
      );

      await program.methods
        .initialize(
          [tokenMint1, tokenMint2],
          Buffer.from([TOKEN1_DECIMALS, TOKEN2_DECIMALS])
        )
        .accounts({
          owner: owner.publicKey,
          marketplaceState: marketplacePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      const marketplaceState = await program.account.marketplaceState.fetch(
        marketplacePda
      );

      console.log(
        "Allowed tokens:",
        marketplaceState.allowedTokens.map((t) => t.toString())
      );
      console.log("Token decimals:", marketplaceState.tokenDecimals);

      // Verify both tokens are properly initialized
      expect(marketplaceState.allowedTokens).to.have.length(2);
      expect(marketplaceState.allowedTokens[0].toString()).to.equal(
        tokenMint1.toString()
      );
      expect(marketplaceState.allowedTokens[1].toString()).to.equal(
        tokenMint2.toString()
      );

      console.log("Marketplace initialized successfully with both tokens");
    } catch (e: any) {
      console.error("Initialization error:", e);
      throw e;
    }
  });

  // Token1 (6 decimals) Flow
  it("2a. Create Campaign with Token1", async () => {
    console.log("Test Case: Create Campaign with Token1 (6 decimals)");

    // Transfer tokens to creator
    const transferTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        ownerTokenAccount1,
        creatorTokenAccount1,
        owner.publicKey,
        TRANSFER_AMOUNT1
      )
    );
    await provider.connection.sendTransaction(transferTx, [owner]);

    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400;
    const promotionEndsIn = now + 86400 * 7;

    // Get campaign counter
    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    const campaignCounter1 = marketplaceState.campaignCounter;

    // Calculate campaign PDA
    [campaignPda1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        creator.publicKey.toBuffer(),
        new BN(campaignCounter1).toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    );

    // Create campaign token account
    campaignTokenAccount1 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator,
      tokenMint1,
      campaignPda1,
      true
    ).then((acc) => acc.address);

    await program.methods
      .createNewCampaign(
        kol.publicKey,
        OFFERING_AMOUNT1,
        new BN(promotionEndsIn),
        new BN(offerEndsIn)
      )
      .accounts({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        tokenMint: tokenMint1,
        campaign: campaignPda1,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund the campaign
    const fundingTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        creatorTokenAccount1,
        campaignTokenAccount1,
        creator.publicKey,
        OFFERING_AMOUNT1.toNumber()
      )
    );
    await provider.connection.sendTransaction(fundingTx, [creator]);

    // Verify campaign state
    const campaign = await program.account.campaign.fetch(campaignPda1);
    expect(campaign.tokenMint.toString()).to.equal(tokenMint1.toString());
    expect(campaign.amountOffered.toString()).to.equal(
      OFFERING_AMOUNT1.toString()
    );
  });

  it("3a. Update Campaign with Token1", async () => {
    console.log("Test Case: Update Campaign with Token1");

    const now = Math.floor(Date.now() / 1000);
    const newOfferEndsIn = now + 172800; // 2 days
    const newPromotionEndsIn = now + 86400 * 14; // 14 days
    const newAmount = OFFERING_AMOUNT1.mul(new BN(2)); // Double the amount

    await program.methods
      .updateCampaign(
        kol.publicKey,
        new BN(newPromotionEndsIn),
        new BN(newOfferEndsIn),
        newAmount
      )
      .accounts({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: campaignPda1,
        tokenMint: tokenMint1,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([creator])
      .rpc();

    // Transfer additional tokens
    const additionalTokens = OFFERING_AMOUNT1.toNumber();
    const fundingTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        creatorTokenAccount1,
        campaignTokenAccount1,
        creator.publicKey,
        additionalTokens
      )
    );
    await provider.connection.sendTransaction(fundingTx, [creator]);

    const campaign = await program.account.campaign.fetch(campaignPda1);
    expect(campaign.amountOffered.toString()).to.equal(newAmount.toString());
  });

  it("4a. Accept Campaign with Token1", async () => {
    console.log("Test Case: Accept Campaign with Token1");

    await program.methods
      .acceptProjectCampaign()
      .accounts({
        marketplaceState: marketplacePda,
        kol: kol.publicKey,
        campaign: campaignPda1,
      })
      .signers([kol])
      .rpc();

    const campaign = await program.account.campaign.fetch(campaignPda1);
    expect(campaign.campaignStatus).to.deep.equal({ accepted: {} });
  });

  it("5a. Fulfill Campaign with Token1", async () => {
    console.log("Test Case: Fulfill Campaign with Token1");

    const beforeKolBalance = await provider.connection.getTokenAccountBalance(
      kolTokenAccount1
    );
    const beforeOwnerBalance = await provider.connection.getTokenAccountBalance(
      ownerTokenAccount1
    );

    await program.methods
      .fulfilProjectCampaign()
      .accounts({
        marketplaceState: marketplacePda,
        owner: owner.publicKey,
        campaign: campaignPda1,
        campaignTokenAccount: campaignTokenAccount1,
        kolTokenAccount: kolTokenAccount1,
        ownerTokenAccount: ownerTokenAccount1,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint1,
      })
      .signers([owner])
      .rpc();

    const afterKolBalance = await provider.connection.getTokenAccountBalance(
      kolTokenAccount1
    );
    const afterOwnerBalance = await provider.connection.getTokenAccountBalance(
      ownerTokenAccount1
    );

    const totalAmount = OFFERING_AMOUNT1.mul(new BN(2)).toNumber();
    const expectedKolAmount = Math.floor(totalAmount * 0.9);
    const expectedOwnerAmount = Math.floor(totalAmount * 0.1);

    expect(
      parseInt(afterKolBalance.value.amount) -
        parseInt(beforeKolBalance.value.amount)
    ).to.equal(expectedKolAmount);
    expect(
      parseInt(afterOwnerBalance.value.amount) -
        parseInt(beforeOwnerBalance.value.amount)
    ).to.equal(expectedOwnerAmount);
  });

  // Token2 (9 decimals) Flow
  it("2b. Create Campaign with Token2", async () => {
    console.log("Test Case: Create Campaign with Token2 (9 decimals)");

    // Similar structure as 2a but using Token2 accounts and amounts
    // Use OFFERING_AMOUNT2, tokenMint2, etc.
  });

  it("3b. Update Campaign with Token2", async () => {
    console.log("Test Case: Update Campaign with Token2");
    // Similar structure as 3a but using Token2
  });

  it("4b. Accept Campaign with Token2", async () => {
    console.log("Test Case: Accept Campaign with Token2");
    // Similar structure as 4a but using Token2
  });

  it("5b. Fulfill Campaign with Token2", async () => {
    console.log("Test Case: Fulfill Campaign with Token2");
    // Similar structure as 5a but using Token2
  });

  // Discard flow for both tokens
  it("6a. Create and Discard Campaign with Token1", async () => {
    console.log("Test Case: Create and Discard Campaign with Token1");

    // First, ensure creator has enough tokens by transferring from owner
    const setupTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        ownerTokenAccount1,
        creatorTokenAccount1,
        owner.publicKey,
        OFFERING_AMOUNT1.toNumber()
      )
    );
    await provider.connection.sendTransaction(setupTx, [owner]);

    // Create new campaign first
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400;
    const promotionEndsIn = now + 86400 * 7;

    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    const campaignCounter = marketplaceState.campaignCounter;

    [campaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        creator.publicKey.toBuffer(),
        new BN(campaignCounter).toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    );

    // Create campaign token account
    campaignTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator,
      tokenMint1,
      campaignPda,
      true
    ).then((acc) => acc.address);

    // Store initial balances before creating campaign
    const beforeCreatorBalance =
      await provider.connection.getTokenAccountBalance(creatorTokenAccount1);

    // Create the campaign first
    await program.methods
      .createNewCampaign(
        kol.publicKey,
        OFFERING_AMOUNT1,
        new BN(promotionEndsIn),
        new BN(offerEndsIn)
      )
      .accounts({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        tokenMint: tokenMint1,
        campaign: campaignPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund the campaign
    const fundingTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        creatorTokenAccount1,
        campaignTokenAccount,
        creator.publicKey,
        OFFERING_AMOUNT1.toNumber()
      )
    );
    await provider.connection.sendTransaction(fundingTx, [creator]);

    // Discard campaign
    await program.methods
      .discardProjectCampaign()
      .accounts({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: campaignPda,
        campaignTokenAccount: campaignTokenAccount,
        creatorTokenAccount: creatorTokenAccount1,
        tokenMint: tokenMint1,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([creator])
      .rpc();

    const afterCreatorBalance =
      await provider.connection.getTokenAccountBalance(creatorTokenAccount1);

    // Log balances for debugging
    console.log("Before balance:", beforeCreatorBalance.value.amount);
    console.log("After balance:", afterCreatorBalance.value.amount);

    expect(
      parseInt(afterCreatorBalance.value.amount) -
        parseInt(beforeCreatorBalance.value.amount)
    ).to.equal(0); // Should be 0 since we're back to the initial state
  });

  it("6b. Create and Discard Campaign with Token2", async () => {
    console.log("Test Case: Create and Discard Campaign with Token2");
    // Similar structure as 6a but using Token2
  });

  // Open Campaign Test Cases
  it("7a. Create Open Campaign with Token1", async () => {
    console.log("Test Case: Create Open Campaign with Token1");

    // First transfer tokens to creator
    const setupTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        ownerTokenAccount1,
        creatorTokenAccount1,
        owner.publicKey,
        OFFERING_AMOUNT1.toNumber() * 2 // Transfer extra for safety
      )
    );
    await provider.connection.sendTransaction(setupTx, [owner]);

    // Verify creator received tokens
    const creatorBalance = await provider.connection.getTokenAccountBalance(
      creatorTokenAccount1
    );
    console.log(
      "Creator balance before campaign:",
      creatorBalance.value.amount
    );
    expect(parseInt(creatorBalance.value.amount)).to.be.at.least(
      OFFERING_AMOUNT1.toNumber()
    );

    const now = Math.floor(Date.now() / 1000);
    const promotionEndsIn = now + 86400 * 7; // 7 days

    // Get campaign counter
    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    const campaignCounter = marketplaceState.campaignCounter;

    // Calculate open campaign PDA
    [openCampaignPda1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("open_campaign"),
        creator.publicKey.toBuffer(),
        new BN(campaignCounter).toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    );

    // Create campaign token account
    openCampaignTokenAccount1 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator,
      tokenMint1,
      openCampaignPda1,
      true
    ).then((acc) => acc.address);

    await program.methods
      .createOpenCampaign(new BN(promotionEndsIn), OFFERING_AMOUNT1)
      .accounts({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        tokenMint: tokenMint1,
        openCampaign: openCampaignPda1,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund the campaign AFTER creation
    const fundingTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        creatorTokenAccount1,
        openCampaignTokenAccount1,
        creator.publicKey,
        OFFERING_AMOUNT1.toNumber()
      )
    );
    await provider.connection.sendTransaction(fundingTx, [creator]);

    // Verify funding with retries
    let campaignBalance;
    for (let i = 0; i < 3; i++) {
      campaignBalance = await provider.connection.getTokenAccountBalance(
        openCampaignTokenAccount1
      );
      if (
        parseInt(campaignBalance.value.amount) === OFFERING_AMOUNT1.toNumber()
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second between retries
    }
    console.log(
      "Campaign balance after funding:",
      campaignBalance?.value.amount
    );
    expect(parseInt(campaignBalance!.value.amount)).to.equal(
      OFFERING_AMOUNT1.toNumber()
    );

    // Verify campaign state
    const campaign = await program.account.openCampaign.fetch(openCampaignPda1);
    expect(campaign.tokenMint.toString()).to.equal(tokenMint1.toString());
    expect(campaign.poolAmount.toString()).to.equal(
      OFFERING_AMOUNT1.toString()
    );
    expect(campaign.campaignStatus).to.deep.equal({ published: {} });
  });

  it("8a. Complete Open Campaign as Fulfilled with Token1", async () => {
    console.log("Test Case: Complete Open Campaign as Fulfilled with Token1");

    // Verify campaign is funded before completing
    const beforeCampaignBalance =
      await provider.connection.getTokenAccountBalance(
        openCampaignTokenAccount1
      );
    expect(parseInt(beforeCampaignBalance.value.amount)).to.equal(
      OFFERING_AMOUNT1.toNumber()
    );

    const beforeOwnerBalance = await provider.connection.getTokenAccountBalance(
      ownerTokenAccount1
    );

    await program.methods
      .completeOpenCampaign(true) // true for fulfilled
      .accounts({
        marketplaceState: marketplacePda,
        owner: owner.publicKey,
        openCampaign: openCampaignPda1,
        campaignTokenAccount: openCampaignTokenAccount1,
        ownerTokenAccount: ownerTokenAccount1,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const afterOwnerBalance = await provider.connection.getTokenAccountBalance(
      ownerTokenAccount1
    );
    const campaign = await program.account.openCampaign.fetch(openCampaignPda1);

    // Verify campaign status
    expect(campaign.campaignStatus).to.deep.equal({ fulfilled: {} });

    // Verify token transfer
    expect(
      parseInt(afterOwnerBalance.value.amount) -
        parseInt(beforeOwnerBalance.value.amount)
    ).to.equal(OFFERING_AMOUNT1.toNumber());
  });

  it("7b. Create Open Campaign with Token2", async () => {
    console.log("Test Case: Create Open Campaign with Token2");

    // First verify Token2 is in allowed tokens and marketplace state
    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    console.log(
      "Allowed tokens:",
      marketplaceState.allowedTokens.map((t) => t.toString())
    );
    console.log("Token2:", tokenMint2.toString());

    // Verify Token2 is in allowed tokens
    const token2InAllowedTokens = marketplaceState.allowedTokens
      .map((t) => t.toString())
      .includes(tokenMint2.toString());

    if (!token2InAllowedTokens) {
      console.log(
        "Token2 not in allowed tokens, reinitializing marketplace..."
      );
      // Reinitialize marketplace with both tokens
      await program.methods
        .initialize(
          [tokenMint1, tokenMint2],
          Buffer.from([TOKEN1_DECIMALS, TOKEN2_DECIMALS])
        )
        .accounts({
          owner: owner.publicKey,
          marketplaceState: marketplacePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
    }

    // First ensure owner has enough tokens
    await mintTo(
      provider.connection,
      owner,
      tokenMint2,
      ownerTokenAccount2,
      owner,
      OFFERING_AMOUNT2.toNumber() * 4
    );

    // Transfer tokens to creator for the campaign
    const setupTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        ownerTokenAccount2,
        creatorTokenAccount2,
        owner.publicKey,
        OFFERING_AMOUNT2.toNumber() * 2
      )
    );
    await provider.connection.sendTransaction(setupTx, [owner]);

    // Verify creator received tokens
    const creatorBalance = await provider.connection.getTokenAccountBalance(
      creatorTokenAccount2
    );
    console.log(
      "Creator balance before campaign:",
      creatorBalance.value.amount
    );

    const now = Math.floor(Date.now() / 1000);
    const promotionEndsIn = now + 86400 * 7; // 7 days

    // Get fresh campaign counter
    const updatedMarketplaceState =
      await program.account.marketplaceState.fetch(marketplacePda);

    // Calculate open campaign PDA
    [openCampaignPda2] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("open_campaign"),
        creator.publicKey.toBuffer(),
        new BN(updatedMarketplaceState.campaignCounter).toArrayLike(
          Buffer,
          "le",
          4
        ),
      ],
      program.programId
    );

    // Create campaign token account
    openCampaignTokenAccount2 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator,
      tokenMint2,
      openCampaignPda2,
      true
    ).then((acc) => acc.address);

    console.log("Creating open campaign with Token2...");
    await program.methods
      .createOpenCampaign(new BN(promotionEndsIn), OFFERING_AMOUNT2)
      .accounts({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        tokenMint: tokenMint2,
        openCampaign: openCampaignPda2,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund the campaign
    const fundingTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        creatorTokenAccount2,
        openCampaignTokenAccount2,
        creator.publicKey,
        OFFERING_AMOUNT2.toNumber()
      )
    );
    await provider.connection.sendTransaction(fundingTx, [creator]);

    // Verify funding with retries
    let campaignBalance;
    for (let i = 0; i < 3; i++) {
      campaignBalance = await provider.connection.getTokenAccountBalance(
        openCampaignTokenAccount2
      );
      if (
        parseInt(campaignBalance.value.amount) === OFFERING_AMOUNT2.toNumber()
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log(
      "Campaign balance after funding:",
      campaignBalance?.value.amount
    );
    expect(parseInt(campaignBalance!.value.amount)).to.equal(
      OFFERING_AMOUNT2.toNumber()
    );

    // Verify campaign state
    const campaign = await program.account.openCampaign.fetch(openCampaignPda2);
    expect(campaign.tokenMint.toString()).to.equal(tokenMint2.toString());
    expect(campaign.poolAmount.toString()).to.equal(
      OFFERING_AMOUNT2.toString()
    );
    expect(campaign.campaignStatus).to.deep.equal({ published: {} });
  });

  it("8b. Complete Open Campaign as Discarded with Token2", async () => {
    console.log("Test Case: Complete Open Campaign as Discarded with Token2");

    const beforeOwnerBalance = await provider.connection.getTokenAccountBalance(
      ownerTokenAccount2
    );

    await program.methods
      .completeOpenCampaign(false) // false for discarded
      .accounts({
        marketplaceState: marketplacePda,
        owner: owner.publicKey,
        openCampaign: openCampaignPda2,
        campaignTokenAccount: openCampaignTokenAccount2,
        ownerTokenAccount: ownerTokenAccount2,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const afterOwnerBalance = await provider.connection.getTokenAccountBalance(
      ownerTokenAccount2
    );
    const campaign = await program.account.openCampaign.fetch(openCampaignPda2);

    // Verify campaign status
    expect(campaign.campaignStatus).to.deep.equal({ discarded: {} });

    // Verify token transfer
    expect(
      parseInt(afterOwnerBalance.value.amount) -
        parseInt(beforeOwnerBalance.value.amount)
    ).to.equal(OFFERING_AMOUNT2.toNumber());
  });
});

// Add a helper function to verify token account funding
async function verifyTokenAccountFunding(
  connection: anchor.web3.Connection,
  tokenAccount: PublicKey,
  expectedAmount: number,
  label: string
) {
  const balance = await connection.getTokenAccountBalance(tokenAccount);
  const actualAmount = parseInt(balance.value.amount);
  if (actualAmount !== expectedAmount) {
    throw new Error(
      `${label} token account funding verification failed. Expected: ${expectedAmount}, Actual: ${actualAmount}`
    );
  }
  console.log(`${label} token account funded with ${actualAmount} tokens`);
}
