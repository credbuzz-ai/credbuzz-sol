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

  let marketplacePda: PublicKey;
  let campaignPda: PublicKey;
  let campaignId: string;
  let campaignSeed: Uint8Array;

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
  });

  it("Create New Campaign", async () => {
    // Current timestamps and amounts
    const now = Math.floor(Date.now() / 1000);
    const offerEndsIn = now + 86400;
    const promotionEndsIn = now + 86400 * 7;
    const offeringAmount = new BN(1000000);

    // The program expects campaign_id as an account constraint
    const campaignId = 23;

    [campaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        Buffer.from(campaignId.toString()),
        creator.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Create the transaction with the correct parameter
    await program.methods
      .createNewCampaign(
        campaignId,
        kol.publicKey,
        offeringAmount,
        new BN(promotionEndsIn),
        new BN(offerEndsIn)
      )
      // The campaign_id is implicitly inferred from the first parameter
      // in the #[instruction(campaign_id: u8)] attribute
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
    console.log(campaign);
    expect(campaign.creatorAddress.toString()).to.equal(
      creator.publicKey.toString()
    );
    expect(campaign.selectedKol.toString()).to.equal(kol.publicKey.toString());
    expect(campaign.amountOffered.toString()).to.equal(
      offeringAmount.toString()
    );
  });

  // Add more tests for update, accept, fulfill...
});
