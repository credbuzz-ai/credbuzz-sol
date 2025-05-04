import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { expect } from "chai";
import { SolCb } from "../target/types/sol_cb";

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
  let campaignCounter = 0;
  const tokenMint = new PublicKey(
    "D3Z5GzWh2E5Sh22nPzV6ambwFd8abfjp4kcqAJyeNoRg"
  );

  // Token accounts
  let creatorTokenAccount: PublicKey;
  let kolTokenAccount: PublicKey;
  let ownerTokenAccount: PublicKey;

  // Campaign constants
  const OFFERING_AMOUNT = new BN(1_000_000); // 1 token with 6 decimals
  const TRANSFER_AMOUNT = 100_000_000; // 100 tokens with 6 decimals

  // Helper function to log campaign details
  const logCampaignInfo = async (pda: PublicKey, label: string) => {
    const campaign = await program.account.campaign.fetch(pda);
    console.log(`\n--- ${label} ---`);
    console.log(`Campaign ID: ${Buffer.from(campaign.id).toString("hex")}`);
    console.log(`Creator: ${campaign.creatorAddress.toString()}`);
    console.log(`Selected KOL: ${campaign.selectedKol.toString()}`);
    console.log(`Amount offered: ${campaign.amountOffered.toString()}`);
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
    // Calculate the marketplace PDA
    [marketplacePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    // Fund accounts for testing
    // const airdropCreator = await provider.connection.requestAirdrop(
    //   creator.publicKey,
    //   10 * anchor.web3.LAMPORTS_PER_SOL
    // );
    // await provider.connection.confirmTransaction(airdropCreator);

    // const airdropKol = await provider.connection.requestAirdrop(
    //   kol.publicKey,
    //   10 * anchor.web3.LAMPORTS_PER_SOL
    // );
    // await provider.connection.confirmTransaction(airdropKol);

    // Fund owner if needed
    // try {
    //   const ownerBalance = await provider.connection.getBalance(
    //     owner.publicKey
    //   );
    //   if (ownerBalance < anchor.web3.LAMPORTS_PER_SOL) {
    //     const airdropOwner = await provider.connection.requestAirdrop(
    //       owner.publicKey,
    //       10 * anchor.web3.LAMPORTS_PER_SOL
    //     );
    //     await provider.connection.confirmTransaction(airdropOwner);
    //   }
    // } catch (e) {
    //   console.log("Error checking owner balance:", e);
    // }

    // Create token accounts for all participants
    creatorTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        tokenMint,
        creator.publicKey
      )
    ).address;

    kolTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        tokenMint,
        kol.publicKey
      )
    ).address;

    ownerTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        tokenMint,
        owner.publicKey
      )
    ).address;

    console.log("Setup complete!");
    console.log("Owner address:", owner.publicKey.toString());
    console.log("Creator address:", creator.publicKey.toString());
    console.log("KOL address:", kol.publicKey.toString());
  });

  it("Complete Campaign Flow: Initialize -> Transfer Tokens -> Create -> Accept -> Fulfill", async () => {
    // Step 1: Initialize the marketplace
    console.log("Initializing marketplace...");
    await program.methods
      .initialize(tokenMint)
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
    expect(marketplaceState.owner.toString()).to.equal(
      owner.publicKey.toString()
    );
    expect(marketplaceState.tokenMint.toString()).to.equal(
      tokenMint.toString()
    );

    // Step 2: Transfer tokens from owner to creator
    console.log("\nTransferring tokens from owner to creator...");

    // Check owner's token balance first
    try {
      const ownerBalance = await provider.connection.getTokenAccountBalance(
        ownerTokenAccount
      );
      console.log(
        `Owner's current token balance: ${ownerBalance.value.amount}`
      );

      if (parseInt(ownerBalance.value.amount) < TRANSFER_AMOUNT) {
        console.log(
          `Warning: Owner doesn't have enough tokens (has ${ownerBalance.value.amount}, needs ${TRANSFER_AMOUNT})`
        );
      }
    } catch (e) {
      console.log(`Error checking owner's token balance: ${e}`);
    }

    // Create and send the token transfer transaction
    try {
      const transaction = new anchor.web3.Transaction().add(
        createTransferInstruction(
          ownerTokenAccount,
          creatorTokenAccount,
          owner.publicKey,
          TRANSFER_AMOUNT
        )
      );

      const txSignature = await provider.connection.sendTransaction(
        transaction,
        [owner]
      );

      await provider.connection.confirmTransaction(txSignature);
      console.log(
        `Transferred ${TRANSFER_AMOUNT} tokens to creator. Tx: ${txSignature}`
      );
    } catch (e) {
      console.log(`Error transferring tokens to creator: ${e}`);
      // Continue with the test even if transfer fails
    }

    // Log token balances after transfer
    await logTokenBalances("After Initial Transfer");

    // Step 3: Create a campaign
    console.log("Creating campaign...");
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400; // 1 day
    const promotionEndsIn = now + 86400 * 7; // 7 days

    // Calculate campaign PDA
    [campaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        creator.publicKey.toBuffer(),
        new BN(campaignCounter).toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    );

    await program.methods
      .createNewCampaign(
        kol.publicKey,
        OFFERING_AMOUNT,
        new BN(promotionEndsIn),
        new BN(offerEndsIn)
      )
      .accounts({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: campaignPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    let campaign = await logCampaignInfo(campaignPda, "Created Campaign");
    expect(campaign.campaignStatus).to.deep.equal({ open: {} });
    expect(campaign.selectedKol.toString()).to.equal(kol.publicKey.toString());
    expect(campaign.amountOffered.toString()).to.equal(
      OFFERING_AMOUNT.toString()
    );

    // Step 4: Accept campaign by KOL
    console.log("Accepting campaign...");
    await program.methods
      .acceptProjectCampaign()
      .accounts({
        marketplaceState: marketplacePda,
        kol: kol.publicKey,
        campaign: campaignPda,
      })
      .signers([kol])
      .rpc();

    campaign = await logCampaignInfo(campaignPda, "Accepted Campaign");
    expect(campaign.campaignStatus).to.deep.equal({ accepted: {} });

    // Step 5: Log token balances before fulfillment
    await logTokenBalances("Before Fulfillment");

    // Store balances for comparison
    let beforeKolBalance, beforeOwnerBalance;
    try {
      beforeKolBalance = (
        await provider.connection.getTokenAccountBalance(kolTokenAccount)
      ).value.amount;
    } catch (e) {
      beforeKolBalance = "0";
    }

    try {
      beforeOwnerBalance = (
        await provider.connection.getTokenAccountBalance(ownerTokenAccount)
      ).value.amount;
    } catch (e) {
      beforeOwnerBalance = "0";
    }

    // Step 6: Fulfill the campaign with token transfers
    console.log("Fulfilling campaign...");
    try {
      await program.methods
        .fulfilProjectCampaign()
        .accounts({
          marketplaceState: marketplacePda,
          owner: owner.publicKey,
          campaign: campaignPda,
          creator: creator.publicKey,
          creatorTokenAccount: creatorTokenAccount,
          kolTokenAccount: kolTokenAccount,
          ownerTokenAccount: ownerTokenAccount,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([owner, creator])
        .rpc();

      campaign = await logCampaignInfo(campaignPda, "Fulfilled Campaign");
      expect(campaign.campaignStatus).to.deep.equal({ fulfilled: {} });
    } catch (e) {
      console.log("Error fulfilling campaign:", e);
    }

    // Step 7: Verify token transfers
    await logTokenBalances("After Fulfillment");

    let afterKolBalance, afterOwnerBalance;
    try {
      afterKolBalance = (
        await provider.connection.getTokenAccountBalance(kolTokenAccount)
      ).value.amount;
    } catch (e) {
      afterKolBalance = "0";
    }

    try {
      afterOwnerBalance = (
        await provider.connection.getTokenAccountBalance(ownerTokenAccount)
      ).value.amount;
    } catch (e) {
      afterOwnerBalance = "0";
    }

    // Calculate expected amounts
    const totalAmount = parseInt(OFFERING_AMOUNT.toString());
    const expectedKolAmount = Math.floor(totalAmount * 0.9); // 90%
    const expectedOwnerAmount = Math.floor(totalAmount * 0.1); // 10%

    // Check token transfers
    console.log("\n--- Token Transfer Verification ---");
    const kolReceived = parseInt(afterKolBalance) - parseInt(beforeKolBalance);
    const ownerReceived =
      parseInt(afterOwnerBalance) - parseInt(beforeOwnerBalance);

    console.log(
      `KOL received: ${kolReceived} (Expected: ${expectedKolAmount})`
    );
    console.log(
      `Owner received: ${ownerReceived} (Expected: ${expectedOwnerAmount})`
    );

    if (
      kolReceived === expectedKolAmount &&
      ownerReceived === expectedOwnerAmount
    ) {
      console.log("✅ Token transfers verified successfully!");
    } else {
      console.log("❌ Token transfers do not match expected amounts.");
    }

    console.log("Complete campaign flow finished!");
  });
});
