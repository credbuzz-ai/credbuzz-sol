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
  let campaignPda: PublicKey;

  // Calculate the marketplace PDA
  before(async () => {
    [marketplacePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    // Calculate the campaign PDA with just creator key in seeds
    [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), creator.publicKey.toBuffer()],
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
    expect(marketplaceState.owner.toString()).to.equal(
      owner.publicKey.toString()
    );
    expect(marketplaceState.campaignCounter).to.equal(0);
  });

  it("Create New Campaign", async () => {
    // Current timestamps and amounts
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400;
    const promotionEndsIn = now + 86400 * 7;
    const offeringAmount = new BN(1000000);

    // Create the transaction without campaign_id parameter
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
        campaign: campaignPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Verify campaign was created
    const campaign = await program.account.campaign.fetch(campaignPda);

    // The campaign ID should be 0 (first generated ID)
    expect(campaign.id).to.equal(0);
    expect(campaign.creatorAddress.toString()).to.equal(
      creator.publicKey.toString()
    );
    expect(campaign.selectedKol.toString()).to.equal(kol.publicKey.toString());
    expect(campaign.amountOffered.toString()).to.equal(
      offeringAmount.toString()
    );

    // Check that the marketplace counter was incremented
    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    expect(marketplaceState.campaignCounter).to.equal(1);
  });

  it("Update Campaign", async () => {
    // New parameters
    const now = Math.floor(Date.now() / 1000);
    const newOfferEndsIn = now + 86400 * 2; // 2 days from now
    const newPromotionEndsIn = now + 86400 * 10; // 10 days from now
    const newOfferingAmount = new BN(2000000); // 2 USDC

    // Update the campaign
    await program.methods
      .updateCampaign(
        newKol.publicKey,
        new BN(newPromotionEndsIn),
        new BN(newOfferEndsIn),
        newOfferingAmount
      )
      .accountsStrict({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: campaignPda,
      })
      .signers([creator])
      .rpc();

    // Verify updated campaign state
    const campaign = await program.account.campaign.fetch(campaignPda);
    expect(campaign.selectedKol.toString()).to.equal(
      newKol.publicKey.toString()
    );
    expect(campaign.amountOffered.toString()).to.equal(
      newOfferingAmount.toString()
    );
    expect(campaign.promotionEndsIn.toString()).to.equal(
      newPromotionEndsIn.toString()
    );
    expect(campaign.offerEndsIn.toString()).to.equal(newOfferEndsIn.toString());
  });

  it("Accept Project Campaign", async () => {
    // First update campaign to set KOL back to original for accepting
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400; // 1 day from now
    const promotionEndsIn = now + 86400 * 7; // 7 days from now

    // Update the campaign to set the KOL to the one who will accept
    await program.methods
      .updateCampaign(
        kol.publicKey,
        new BN(promotionEndsIn),
        new BN(offerEndsIn),
        new BN(1000000)
      )
      .accountsStrict({
        marketplaceState: marketplacePda,
        creator: creator.publicKey,
        campaign: campaignPda,
      })
      .signers([creator])
      .rpc();

    // Now accept the campaign
    await program.methods
      .acceptProjectCampaign()
      .accountsStrict({
        marketplaceState: marketplacePda,
        kol: kol.publicKey,
        campaign: campaignPda,
      })
      .signers([kol])
      .rpc();

    // Verify campaign is now accepted
    const campaign = await program.account.campaign.fetch(campaignPda);
    expect(campaign.campaignStatus.accepted).to.not.be.undefined;
  });

  it("Fulfill Project Campaign", async () => {
    await program.methods
      .fulfilProjectCampaign()
      .accountsStrict({
        marketplaceState: marketplacePda,
        owner: owner.publicKey,
        campaign: campaignPda,
      })
      .rpc();

    // Verify campaign is now fulfilled
    const campaign = await program.account.campaign.fetch(campaignPda);
    expect(campaign.campaignStatus.fulfilled).to.not.be.undefined;
  });

  it("Fail to create campaign with invalid parameters", async () => {
    // Create a new keypair for a fresh campaign
    const newCreator = Keypair.generate();

    // Airdrop some SOL to the new creator
    const airdropNewCreator = await provider.connection.requestAirdrop(
      newCreator.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropNewCreator);

    // Calculate a new campaign PDA
    const [newCampaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), newCreator.publicKey.toBuffer()],
      program.programId
    );

    // Try to create a campaign with zero amount
    try {
      await program.methods
        .createNewCampaign(
          kol.publicKey,
          new BN(0), // Invalid amount
          new BN(Math.floor(Date.now() / 1000) + 86400),
          new BN(Math.floor(Date.now() / 1000) + 86400 * 2)
        )
        .accountsStrict({
          marketplaceState: marketplacePda,
          creator: newCreator.publicKey,
          campaign: newCampaignPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([newCreator])
        .rpc();
      expect.fail("Should have failed with invalid amount");
    } catch (error) {
      expect(error.toString()).to.include("InvalidAmount");
    }
  });

  it("Fail to accept campaign by unauthorized KOL", async () => {
    // Create a new campaign
    const unauthorizedKol = Keypair.generate();
    const airdropUnauthorizedKol = await provider.connection.requestAirdrop(
      unauthorizedKol.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropUnauthorizedKol);

    try {
      await program.methods
        .acceptProjectCampaign()
        .accountsStrict({
          marketplaceState: marketplacePda,
          kol: unauthorizedKol.publicKey,
          campaign: campaignPda,
        })
        .signers([unauthorizedKol])
        .rpc();
      expect.fail("Should have failed with unauthorized error");
    } catch (error) {
      expect(error.toString()).to.include("Unauthorized");
    }
  });

  it("Create a second campaign and verify counter increments", async () => {
    // Create another creator
    const creator2 = Keypair.generate();

    // Fund account
    const airdropCreator2 = await provider.connection.requestAirdrop(
      creator2.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropCreator2);

    // Calculate PDA for second campaign
    const [campaign2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), creator2.publicKey.toBuffer()],
      program.programId
    );

    // Current timestamps and amounts
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400;
    const promotionEndsIn = now + 86400 * 7;
    const offeringAmount = new BN(1000000);

    // Create the second campaign
    await program.methods
      .createNewCampaign(
        kol.publicKey,
        offeringAmount,
        new BN(promotionEndsIn),
        new BN(offerEndsIn)
      )
      .accountsStrict({
        marketplaceState: marketplacePda,
        creator: creator2.publicKey,
        campaign: campaign2Pda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator2])
      .rpc();

    // Verify campaign was created with ID 1
    const campaign2 = await program.account.campaign.fetch(campaign2Pda);
    expect(campaign2.id).to.equal(1);

    // Check that the marketplace counter was incremented to 2
    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    expect(marketplaceState.campaignCounter).to.equal(2);
  });
});
