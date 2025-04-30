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

  // Helper function to convert bytes to hex string
  const bytesToHex = (bytes: number[]): string => {
    return (
      "0x" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  };

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

    // Log the campaign ID in hex format
    console.log("Campaign ID:", bytesToHex(campaign.id));

    // We can't predict the exact ID now, but we can check it's not all zeros
    expect(campaign.id).to.not.deep.equal([0, 0, 0, 0]);
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

  it("Create a second campaign and verify it has a different ID", async () => {
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

    // Verify campaign was created with a different ID
    const campaign2 = await program.account.campaign.fetch(campaign2Pda);

    // Log the campaign ID in hex format
    console.log("Campaign 2 ID:", bytesToHex(campaign2.id));

    // Verify the first campaign
    const campaign1 = await program.account.campaign.fetch(campaignPda);
    console.log("Campaign 1 ID:", bytesToHex(campaign1.id));

    // IDs should be different
    expect(campaign2.id).to.not.deep.equal(campaign1.id);

    // Check that the marketplace counter was incremented to 2
    const marketplaceState = await program.account.marketplaceState.fetch(
      marketplacePda
    );
    expect(marketplaceState.campaignCounter).to.equal(2);
  });
});
