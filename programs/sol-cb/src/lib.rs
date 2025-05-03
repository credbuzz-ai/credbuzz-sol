use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("DhmJw64wiY46tmx5tetA41wwuoEGFUHhnsMduCVxAkcv");

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, Debug, PartialEq)]
pub enum CampaignStatus {
    Open,
    Accepted,
    Fulfilled,
    Unfulfilled,
    Discarded,
}

#[account]
pub struct Campaign {
    pub id: [u8; 4],
    pub counter: u32,
    pub created_at: i64,
    pub creator_address: Pubkey,
    pub selected_kol: Pubkey,
    pub offer_ends_in: i64,
    pub promotion_ends_in: i64,
    pub amount_offered: u64,
    pub campaign_status: CampaignStatus,
}

impl Space for Campaign {
    const INIT_SPACE: usize = 8 + // Discriminator
        4 + // id
        4 + // counter
        8 + // created_at
        32 + // creator_address
        32 + // selected_kol
        8 + // offer_ends_in
        8 + // promotion_ends_in
        8 + // amount_offered
        1 + // campaign_status
        64; // extra padding for safety
}

#[account]
pub struct MarketplaceState {
    pub owner: Pubkey,
    pub campaign_counter: u32,
}

impl Space for MarketplaceState {
    const INIT_SPACE: usize = 8 + // Discriminator
        32 + // owner
        4; // campaign_counter
}

#[program]
pub mod sol_cb {
    use super::*;

    // ------------------ GLOBAL CONSTANTS ------------------
    pub const DIVIDER: u64 = 10_000;
    pub const BASE_USDC_DECIMALS: u8 = 6;

    // ------------------ ERRORS ------------------
    #[error_code]
    pub enum CustomErrorCode {
        #[msg("Unauthorized access")]
        Unauthorized,
        #[msg("Invalid campaign status")]
        InvalidCampaignStatus,
        #[msg("Invalid KOL address")]
        InvalidKolAddress,
        #[msg("Campaign has expired")]
        CampaignExpired,
        #[msg("Invalid time parameters")]
        InvalidTimeParameters,
        #[msg("Invalid amount")]
        InvalidAmount,
    }

    pub fn initialize(ctx: Context<InitializeMarketplace>) -> Result<()> {
        ctx.accounts.marketplace_state.owner = ctx.accounts.owner.key();
        ctx.accounts.marketplace_state.campaign_counter = 0;
        Ok(())
    }

    pub fn create_new_campaign(
        ctx: Context<CreateNewCampaign>,
        selected_kol: Pubkey,
        offering_amount: u64,
        promotion_ends_in: i64,
        offer_ends_in: i64,
    ) -> Result<()> {
        if offering_amount == 0 {
            return err!(CustomErrorCode::InvalidAmount);
        }

        let current_time = Clock::get()?.unix_timestamp;
        if offer_ends_in <= current_time || promotion_ends_in <= current_time {
            return err!(CustomErrorCode::InvalidTimeParameters);
        }

        // Generate a campaign ID by creating a hash of creator key and timestamp
        let creator_key = ctx.accounts.creator.key();
        let counter = ctx.accounts.marketplace_state.campaign_counter;

        // Create input data to hash - combine creator key, counter, and timestamp for uniqueness
        let mut data_to_hash = vec![];
        data_to_hash.extend_from_slice(&current_time.to_le_bytes());
        data_to_hash.extend_from_slice(creator_key.as_ref());
        data_to_hash.extend_from_slice(&counter.to_le_bytes());

        // Hash the data and take first 4 bytes
        let hashed = hash(&data_to_hash).to_bytes();
        let id_data = [hashed[0], hashed[1], hashed[2], hashed[3]];

        // Increment the counter
        ctx.accounts.marketplace_state.campaign_counter = ctx
            .accounts
            .marketplace_state
            .campaign_counter
            .checked_add(1)
            .unwrap();

        let campaign = &mut ctx.accounts.campaign;
        campaign.id = id_data;
        campaign.counter = counter;
        campaign.created_at = current_time;
        campaign.creator_address = ctx.accounts.creator.key();
        campaign.selected_kol = selected_kol;
        campaign.offer_ends_in = offer_ends_in;
        campaign.promotion_ends_in = promotion_ends_in;
        campaign.amount_offered = offering_amount;
        campaign.campaign_status = CampaignStatus::Open;

        msg!(
            "Campaign created with ID: {:?}, creator: {:?} and counter: {:?}",
            id_data,
            ctx.accounts.creator.key(),
            counter
        );

        Ok(())
    }

    pub fn update_campaign(
        ctx: Context<UpdateCampaign>,
        selected_kol: Pubkey,
        promotion_ends_in: i64,
        offer_ends_in: i64,
        new_amount_offered: u64,
    ) -> Result<()> {
        if selected_kol == Pubkey::default() {
            return err!(CustomErrorCode::InvalidKolAddress);
        }

        let campaign = &mut ctx.accounts.campaign;

        if campaign.campaign_status != CampaignStatus::Open {
            return err!(CustomErrorCode::InvalidCampaignStatus);
        }

        if campaign.creator_address != ctx.accounts.creator.key() {
            return err!(CustomErrorCode::Unauthorized);
        }

        campaign.selected_kol = selected_kol;
        campaign.promotion_ends_in = promotion_ends_in;
        campaign.offer_ends_in = offer_ends_in;
        campaign.amount_offered = new_amount_offered;

        msg!(
            "Campaign updated with ID: {:?}, updated by: {:?}",
            campaign.id,
            ctx.accounts.creator.key()
        );

        Ok(())
    }

    pub fn accept_project_campaign(ctx: Context<AcceptProjectCampaign>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let current_time = Clock::get()?.unix_timestamp;

        if current_time > campaign.offer_ends_in {
            return err!(CustomErrorCode::CampaignExpired);
        }

        if campaign.selected_kol != ctx.accounts.kol.key() {
            return err!(CustomErrorCode::Unauthorized);
        }

        if campaign.campaign_status != CampaignStatus::Open {
            return err!(CustomErrorCode::InvalidCampaignStatus);
        }

        campaign.campaign_status = CampaignStatus::Accepted;

        msg!(
            "Campaign accepted with ID: {:?}, accepted by: {:?}",
            campaign.id,
            ctx.accounts.kol.key()
        );

        Ok(())
    }

    pub fn fulfil_project_campaign(ctx: Context<FulfilProjectCampaign>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        if campaign.campaign_status != CampaignStatus::Accepted {
            return err!(CustomErrorCode::InvalidCampaignStatus);
        }

        campaign.campaign_status = CampaignStatus::Fulfilled;

        msg!("Campaign fulfilled with ID: {:?}", campaign.id);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MarketplaceState::INIT_SPACE,
        seeds = [b"marketplace"],
        bump,
    )]
    pub marketplace_state: Account<'info, MarketplaceState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateNewCampaign<'info> {
    #[account(
        mut,
        seeds = [b"marketplace"],
        bump,
    )]
    pub marketplace_state: Account<'info, MarketplaceState>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = Campaign::INIT_SPACE,
        seeds = [b"campaign", creator.key().as_ref(), &marketplace_state.campaign_counter.to_le_bytes()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateCampaign<'info> {
    #[account(
        mut,
        seeds = [b"marketplace"],
        bump,
    )]
    pub marketplace_state: Account<'info, MarketplaceState>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"campaign", creator.key().as_ref(), &campaign.counter.to_le_bytes()],
        bump,
        constraint = campaign.creator_address == creator.key() @ CustomErrorCode::Unauthorized
    )]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
pub struct AcceptProjectCampaign<'info> {
    #[account(
        mut,
        seeds = [b"marketplace"],
        bump,
    )]
    pub marketplace_state: Account<'info, MarketplaceState>,
    #[account(mut)]
    pub kol: Signer<'info>,
    #[account(
        mut,
        seeds = [b"campaign", campaign.creator_address.as_ref(), &campaign.counter.to_le_bytes()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
pub struct FulfilProjectCampaign<'info> {
    #[account(
        mut,
        seeds = [b"marketplace"],
        bump,
    )]
    pub marketplace_state: Account<'info, MarketplaceState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"campaign", campaign.creator_address.as_ref(), &campaign.counter.to_le_bytes()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,
}

#[event]
pub struct CampaignUpdated {
    pub campaign_id: [u8; 4],
    pub updated_by: Pubkey,
}

#[event]
pub struct CampaignAccepted {
    pub campaign_id: [u8; 4],
    pub accepted_by: Pubkey,
}

#[event]
pub struct CampaignFulfilled {
    pub campaign_id: [u8; 4],
}
