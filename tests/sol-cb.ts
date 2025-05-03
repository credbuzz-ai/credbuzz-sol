import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { SolCb } from "../target/types/sol_cb";

describe("sol-cb", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolCb as Program<SolCb>;
  const owner = provider.wallet;
  const creator = Keypair.generate();
  const kol = Keypair.generate();
  const newKol = Keypair.generate();

  let marketplacePda: PublicKey;
  let firstCampaignPda: PublicKey;
  let firstCampaignCounter: number;
  let secondCampaignPda: PublicKey;
  let secondCampaignCounter: number;
  let campaignCounter = 0;

  // Helper function to convert bytes to hex string
  const bytesToHex = (bytes: number[]): string => {
    return (
      "0x" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  };

  // Helper function to convert number to little-endian byte array
  const numberToLEBytes = (num: number, byteLength: number = 4): Buffer => {
    const buf = Buffer.alloc(byteLength);
    buf.writeUInt32LE(num, 0);
    return buf;
  };

  // Helper function to log campaign details
  const logCampaignInfo = async (pda: PublicKey, label: string) => {
    const campaign = await program.account.campaign.fetch(pda);
    console.log(`\n--- ${label} ---`);
    console.log(`Campaign ID: ${bytesToHex(campaign.id)}`);
    console.log(`Campaign Counter: ${campaign.counter}`);
    console.log(`Campaign PDA: ${pda.toString()}`);
    console.log(`Creator: ${campaign.creatorAddress.toString()}`);
    console.log(`Selected KOL: ${campaign.selectedKol.toString()}`);
    console.log(`Amount offered: ${campaign.amountOffered.toString()}`);
    console.log(`Status: ${Object.keys(campaign.campaignStatus)[0]}`);
    console.log(
      `Created at: ${new Date(
        campaign.createdAt.toNumber() * 1000
      ).toISOString()}`
    );
    console.log("-------------------------\n");

    return campaign;
  };

  // Calculate the marketplace PDA
  before(async () => {
    [marketplacePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    // Fund accounts for testing
    const airdropCreator = await provider.connection.requestAirdrop(
      creator.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropCreator);

    const airdropKol = await provider.connection.requestAirdrop(
      kol.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropKol);

    const airdropNewKol = await provider.connection.requestAirdrop(
      newKol.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropNewKol);
  });

  it("Initialize Marketplace", async () => {
    await program.methods
      .initialize()
      .accounts({
        owner: owner.publicKey,
        marketplaceState: marketplacePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Verify marketplace state
    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    console.log(
      "Marketplace initialized with owner:",
      marketplaceState.owner.toString()
    );
    expect(marketplaceState.owner.toString()).to.equal(
      owner.publicKey.toString()
    );
    expect(marketplaceState.campaignCounter).to.equal(0);
  });

  it("Create First Campaign", async () => {
    // Current timestamps and amounts
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400;
    const promotionEndsIn = now + 86400 * 7;
    const offeringAmount = new BN(1000000);

    console.log("campaignCounter", campaignCounter);
    // Use the campaign counter for PDA
    [firstCampaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        creator.publicKey.toBuffer(),
        numberToLEBytes(campaignCounter),
      ],
      program.programId
    );

    console.log(
      `Creating first campaign at address: ${firstCampaignPda.toString()}`
    );

    // Create the transaction
    await program.methods
      .createNewCampaign(
        kol.publicKey,
        offeringAmount,
        new BN(promotionEndsIn),
        new BN(offerEndsIn)
      )
      .accountsStrict({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: firstCampaignPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Verify campaign was created and log details
    const campaign = await logCampaignInfo(firstCampaignPda, "First Campaign");
    firstCampaignCounter = campaign.counter;

    // We can't predict the exact ID now, but we can check it's not all zeros
    expect(campaign.id).to.not.deep.equal([0, 0, 0, 0]);
    expect(campaign.counter).to.equal(campaignCounter);

    // Increment local counter to match program
    campaignCounter++;
  });

  it("Create Second Campaign for Same User", async () => {
    // Current timestamps and amounts
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400 * 2; // 2 days
    const promotionEndsIn = now + 86400 * 14; // 14 days
    const offeringAmount = new BN(2000000); // 2 USDC

    // Use the campaign counter for PDA
    [secondCampaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        creator.publicKey.toBuffer(),
        numberToLEBytes(campaignCounter),
      ],
      program.programId
    );

    console.log(
      `Creating second campaign at address: ${secondCampaignPda.toString()}`
    );

    // Create the second campaign for the same user
    await program.methods
      .createNewCampaign(
        newKol.publicKey, // Use a different KOL to distinguish
        offeringAmount,
        new BN(promotionEndsIn),
        new BN(offerEndsIn)
      )
      .accountsStrict({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: secondCampaignPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Verify second campaign was created and log details
    const campaign = await logCampaignInfo(
      secondCampaignPda,
      "Second Campaign (Same User)"
    );
    secondCampaignCounter = campaign.counter;

    // Increment local counter to match program
    campaignCounter++;

    // Log both campaigns to demonstrate multiple campaigns per user
    console.log("\n--- Multiple Campaigns Verification ---");
    console.log(`Same creator: ${firstCampaignPda} and ${secondCampaignPda}`);
    console.log(`First campaign counter: ${firstCampaignCounter}`);
    console.log(`Second campaign counter: ${secondCampaignCounter}`);
  });

  it("Update First Campaign", async () => {
    // New parameters
    const now = Math.floor(Date.now() / 1000);
    const newOfferEndsIn = now + 86400 * 3; // 3 days from now
    const newPromotionEndsIn = now + 86400 * 10; // 10 days from now
    const newOfferingAmount = new BN(1500000); // 1.5 USDC

    // Now we'll use the counter-based PDA addressing
    console.log(
      "Using campaign address for update:",
      firstCampaignPda.toString()
    );

    // Update the first campaign
    await program.methods
      .updateCampaign(
        kol.publicKey,
        new BN(newPromotionEndsIn),
        new BN(newOfferEndsIn),
        newOfferingAmount
      )
      .accountsStrict({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: firstCampaignPda,
      })
      .signers([creator])
      .rpc();

    // Verify the campaign was updated
    const updatedCampaign = await logCampaignInfo(
      firstCampaignPda,
      "Updated First Campaign"
    );

    // Check that the amount was updated
    expect(updatedCampaign.amountOffered.toString()).to.equal(
      newOfferingAmount.toString()
    );
    // Check that counter remains the same
    expect(updatedCampaign.counter).to.equal(firstCampaignCounter);
  });

  it("Create Three Campaigns for Same Creator", async () => {
    // Create a new keypair for this test to start fresh
    const multiCreator = Keypair.generate();
    const kol1 = Keypair.generate();
    const kol2 = Keypair.generate();
    const kol3 = Keypair.generate();

    // Fund the creator account
    const airdropCreator = await provider.connection.requestAirdrop(
      multiCreator.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropCreator);

    // Fund KOLs
    for (const kolAccount of [kol1, kol2, kol3]) {
      const airdrop = await provider.connection.requestAirdrop(
        kolAccount.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdrop);
    }

    // Get the current marketplace state to get the correct campaign counter
    let marketplaceState;
    try {
      marketplaceState = await program.account.marketplaceState.fetch(
        marketplacePda
      );
      console.log(
        "Current marketplace campaign counter:",
        marketplaceState.campaignCounter.toString()
      );
    } catch (e) {
      console.log("Error fetching marketplace state:", e);
      return;
    }

    // Use the global campaign counter from marketplace
    let creatorCampaignCounter = marketplaceState.campaignCounter;
    const campaignPdas: PublicKey[] = [];
    const campaignCounters: number[] = [];

    // Current timestamp
    const now = Math.floor(Date.now() / 1000);

    // Create 3 campaigns with different parameters
    const campaignParams = [
      {
        kol: kol1.publicKey,
        amount: new BN(1000000), // 1 USDC
        promotionEndsIn: now + 86400 * 7, // 7 days
        offerEndsIn: now + 86400 * 1, // 1 day
        label: "Creator Campaign 1",
      },
      {
        kol: kol2.publicKey,
        amount: new BN(2000000), // 2 USDC
        promotionEndsIn: now + 86400 * 14, // 14 days
        offerEndsIn: now + 86400 * 2, // 2 days
        label: "Creator Campaign 2",
      },
      {
        kol: kol3.publicKey,
        amount: new BN(3000000), // 3 USDC
        promotionEndsIn: now + 86400 * 21, // 21 days
        offerEndsIn: now + 86400 * 3, // 3 days
        label: "Creator Campaign 3",
      },
    ];

    console.log("\n=== Creating Three Campaigns for Same Creator ===");

    // Create each campaign
    for (let i = 0; i < 3; i++) {
      const params = campaignParams[i];

      // Calculate PDA
      const [campaignPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          multiCreator.publicKey.toBuffer(),
          numberToLEBytes(Number(creatorCampaignCounter)),
        ],
        program.programId
      );

      campaignPdas.push(campaignPda);
      console.log(
        `Creating campaign ${i + 1} at PDA: ${campaignPda.toString()}`
      );
      console.log(`Using counter: ${creatorCampaignCounter.toString()}`);

      // Create campaign
      await program.methods
        .createNewCampaign(
          params.kol,
          params.amount,
          new BN(params.promotionEndsIn),
          new BN(params.offerEndsIn)
        )
        .accountsStrict({
          marketplaceState: marketplacePda,
          creator: multiCreator.publicKey,
          campaign: campaignPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([multiCreator])
        .rpc();

      // Log and store campaign info
      const campaign = await logCampaignInfo(campaignPda, params.label);
      campaignCounters.push(campaign.counter);

      // Update marketplace state after each campaign to get the latest counter
      marketplaceState = await program.account.marketplaceState.fetch(
        marketplacePda
      );
      creatorCampaignCounter = marketplaceState.campaignCounter;
      console.log(`Updated counter: ${creatorCampaignCounter.toString()}`);
    }

    // Print summary of all campaigns
    console.log("\n=== Multiple Campaigns Summary ===");
    console.log(`Creator: ${multiCreator.publicKey.toString()}`);

    for (let i = 0; i < 3; i++) {
      console.log(`\nCampaign ${i + 1}:`);
      console.log(`- Counter: ${campaignCounters[i]}`);
      console.log(`- PDA: ${campaignPdas[i].toString()}`);
      console.log(`- KOL: ${campaignParams[i].kol.toString()}`);
      console.log(`- Amount: ${campaignParams[i].amount.toString()}`);
    }

    console.log("\n======================================");
  });
});
