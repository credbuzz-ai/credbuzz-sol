use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token::{self, Mint, TokenAccount, Transfer};

declare_id!("7fHedDQScjY4dRUhuqNBkx4vgdi5RSv9LdVbonCn53PR");

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, Debug, PartialEq)]
pub enum CampaignStatus {
    Open,
    Accepted,
    Fulfilled,
    Unfulfilled,
    Discarded,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, Debug, PartialEq)]
pub enum OpenCampaignStatus {
    Published,
    Fulfilled,
    Discarded,
}

#[account]
pub struct Campaign {
    pub id: [u8; 4],
    pub counter: u32,
    pub created_at: i64,
    pub creator_address: Pubkey,
    pub token_mint: Pubkey,
    pub selected_kol: Pubkey,
    pub offer_ends_in: i64,
    pub promotion_ends_in: i64,
    pub amount_offered: u64,
    pub campaign_status: CampaignStatus,
}

#[account]
pub struct OpenCampaign {
    pub id: [u8; 4],
    pub counter: u32,
    pub created_at: i64,
    pub creator_address: Pubkey,
    pub token_mint: Pubkey,
    pub promotion_ends_in: i64,
    pub pool_amount: u64,
    pub campaign_status: OpenCampaignStatus,
}

impl Space for Campaign {
    const INIT_SPACE: usize = 8 + // Discriminator
        4 + // id
        4 + // counter
        8 + // created_at
        32 + // creator_address
        32 + // token_mint
        32 + // selected_kol
        8 + // offer_ends_in
        8 + // promotion_ends_in
        8 + // amount_offered
        1 + // campaign_status
        64; // extra padding for safety
}

impl Space for OpenCampaign {
    const INIT_SPACE: usize = 8 + // Discriminator
        4 + // id
        4 + // counter
        8 + // created_at
        32 + // creator_address
        32 + // token_mint
        8 + // promotion_ends_in
        8 + // pool_amount
        1 + // campaign_status
        64; // extra padding for safety
}

#[account]
pub struct MarketplaceState {
    pub owner: Pubkey,
    pub campaign_counter: u32,
    pub allowed_tokens: Vec<Pubkey>, // Allowed tokens for payments
    pub token_decimals: Vec<u8>,     // Token decimals in same order as allowed_tokens
}

impl Space for MarketplaceState {
    const INIT_SPACE: usize = 8 + // Discriminator
        32 + // owner
        4 + // campaign_counter
        (32 * 20) + // allowed_tokens (max 20 tokens)
        20 + // token_decimals (max 20 tokens)
        64; // extra padding for safety
}

#[program]
pub mod sol_cb {
    use super::*;

    // ------------------ GLOBAL CONSTANTS ------------------
    pub const DIVIDER: u64 = 10_000;
    pub const KOL_SHARE_PERCENTAGE: u64 = 9000; // 90% of the total amount
    pub const OWNER_SHARE_PERCENTAGE: u64 = 1000; // 10% of the total amount

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
        #[msg("Insufficient funds for transfer")]
        InsufficientFunds,
        #[msg("Invalid parameters")]
        InvalidParameters,
        #[msg("Too many tokens")]
        TooManyTokens,
        #[msg("Invalid open campaign status")]
        InvalidOpenCampaignStatus,
    }

    pub fn initialize(
        ctx: Context<InitializeMarketplace>,
        allowed_tokens: Vec<Pubkey>,
        token_decimals: Vec<u8>,
    ) -> Result<()> {
        require!(
            allowed_tokens.len() == token_decimals.len(),
            CustomErrorCode::InvalidParameters
        );
        require!(allowed_tokens.len() <= 10, CustomErrorCode::TooManyTokens);

        ctx.accounts.marketplace_state.owner = ctx.accounts.owner.key();
        ctx.accounts.marketplace_state.campaign_counter = 0;
        ctx.accounts.marketplace_state.allowed_tokens = allowed_tokens;
        ctx.accounts.marketplace_state.token_decimals = token_decimals;
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
        campaign.token_mint = ctx.accounts.token_mint.key();
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

        campaign.token_mint = ctx.accounts.token_mint.key();
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

    pub fn discard_project_campaign(ctx: Context<DiscardProjectCampaign>) -> Result<()> {
        // Extract values before mutable borrow
        let creator_address = ctx.accounts.campaign.creator_address;
        let counter = ctx.accounts.campaign.counter;
        let campaign_balance = ctx.accounts.campaign_token_account.amount;

        if creator_address != ctx.accounts.creator.key() {
            return err!(CustomErrorCode::Unauthorized);
        }

        if campaign_balance > 0 {
            let bump = ctx.bumps.campaign;
            let seeds = &[
                b"campaign",
                creator_address.as_ref(),
                &counter.to_le_bytes(),
                &[bump],
            ];

            ctx.accounts.campaign.campaign_status = CampaignStatus::Discarded;

            let signer_seeds = &[&seeds[..]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.campaign_token_account.to_account_info(),
                        to: ctx.accounts.creator_token_account.to_account_info(),
                        authority: ctx.accounts.campaign.to_account_info(),
                    },
                    signer_seeds,
                ),
                campaign_balance,
            )?;

            msg!("Transferred {} tokens back to creator", campaign_balance);
        }

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
        // Check campaign status first
        if ctx.accounts.campaign.campaign_status != CampaignStatus::Accepted {
            return err!(CustomErrorCode::InvalidCampaignStatus);
        }

        let bump = ctx.bumps.campaign;

        // Extract all the data we need before doing any mutable operations
        let creator_address = ctx.accounts.campaign.creator_address;
        let counter = ctx.accounts.campaign.counter;
        let total_amount = ctx.accounts.campaign.amount_offered;

        // Calculate amounts based on percentages
        let kol_amount = total_amount
            .checked_mul(KOL_SHARE_PERCENTAGE)
            .unwrap()
            .checked_div(DIVIDER)
            .unwrap();
        let owner_amount = total_amount
            .checked_mul(OWNER_SHARE_PERCENTAGE)
            .unwrap()
            .checked_div(DIVIDER)
            .unwrap();

        // Get campaign ID for logging
        let campaign_id = ctx.accounts.campaign.id;

        // Update campaign status
        ctx.accounts.campaign.campaign_status = CampaignStatus::Fulfilled;

        // Set up seeds for signing
        let seeds = &[
            b"campaign",
            creator_address.as_ref(),
            &counter.to_le_bytes(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer tokens to KOL (90%)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.campaign_token_account.to_account_info(),
                    to: ctx.accounts.kol_token_account.to_account_info(),
                    authority: ctx.accounts.campaign.to_account_info(),
                },
                signer_seeds,
            ),
            kol_amount,
        )?;

        // Transfer tokens to Owner (10%)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.campaign_token_account.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.campaign.to_account_info(),
                },
                signer_seeds,
            ),
            owner_amount,
        )?;

        msg!(
            "Campaign fulfilled with ID: {:?}. Transferred {} to KOL and {} to owner",
            campaign_id,
            kol_amount,
            owner_amount
        );

        Ok(())
    }

    pub fn create_open_campaign(
        ctx: Context<CreateOpenCampaign>,
        promotion_ends_in: i64,
        pool_amount: u64,
    ) -> Result<()> {
        if pool_amount == 0 {
            return err!(CustomErrorCode::InvalidAmount);
        }

        let current_time = Clock::get()?.unix_timestamp;
        if promotion_ends_in <= current_time {
            return err!(CustomErrorCode::InvalidTimeParameters);
        }

        // Generate campaign ID similar to regular campaigns
        let creator_key = ctx.accounts.creator.key();
        let counter = ctx.accounts.marketplace_state.campaign_counter;

        let mut data_to_hash = vec![];
        data_to_hash.extend_from_slice(&current_time.to_le_bytes());
        data_to_hash.extend_from_slice(creator_key.as_ref());
        data_to_hash.extend_from_slice(&counter.to_le_bytes());

        let hashed = hash(&data_to_hash).to_bytes();
        let id_data = [hashed[0], hashed[1], hashed[2], hashed[3]];

        // Increment the counter
        ctx.accounts.marketplace_state.campaign_counter = ctx
            .accounts
            .marketplace_state
            .campaign_counter
            .checked_add(1)
            .unwrap();

        let campaign = &mut ctx.accounts.open_campaign;
        campaign.id = id_data;
        campaign.counter = counter;
        campaign.created_at = current_time;
        campaign.creator_address = ctx.accounts.creator.key();
        campaign.token_mint = ctx.accounts.token_mint.key();
        campaign.promotion_ends_in = promotion_ends_in;
        campaign.pool_amount = pool_amount;
        campaign.campaign_status = OpenCampaignStatus::Published;

        msg!(
            "Open campaign created with ID: {:?}, creator: {:?} and counter: {:?}",
            id_data,
            ctx.accounts.creator.key(),
            counter
        );

        Ok(())
    }

    pub fn complete_open_campaign(
        ctx: Context<CompleteOpenCampaign>,
        is_fulfilled: bool,
    ) -> Result<()> {
        // Check authorization first
        if ctx.accounts.marketplace_state.owner != ctx.accounts.owner.key() {
            return err!(CustomErrorCode::Unauthorized);
        }

        // Store the status check result before mutable borrow
        let is_published =
            ctx.accounts.open_campaign.campaign_status == OpenCampaignStatus::Published;
        if !is_published {
            return err!(CustomErrorCode::InvalidOpenCampaignStatus);
        }

        // Get amount before mutable borrow
        let pool_amount = ctx.accounts.open_campaign.pool_amount;

        // Update status
        ctx.accounts.open_campaign.campaign_status = if is_fulfilled {
            OpenCampaignStatus::Fulfilled
        } else {
            OpenCampaignStatus::Discarded
        };

        // Transfer pool amount to owner
        let bump = ctx.bumps.open_campaign;
        let seeds = &[
            b"open_campaign",
            ctx.accounts.open_campaign.creator_address.as_ref(),
            &ctx.accounts.open_campaign.counter.to_le_bytes(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.campaign_token_account.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.open_campaign.to_account_info(),
                },
                signer_seeds,
            ),
            pool_amount,
        )?;

        msg!(
            "Open campaign completed with ID: {:?}, status: {:?}",
            ctx.accounts.open_campaign.id,
            ctx.accounts.open_campaign.campaign_status
        );

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
        constraint = marketplace_state.allowed_tokens.contains(&token_mint.key())
    )]
    pub token_mint: Account<'info, Mint>,
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

    #[account(mut,
        constraint = token_mint.key() == campaign.token_mint
    )]
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
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
pub struct DiscardProjectCampaign<'info> {
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
        seeds = [b"campaign", campaign.creator_address.as_ref(), &campaign.counter.to_le_bytes()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        constraint = campaign_token_account.owner == campaign.key(),
        constraint = marketplace_state.allowed_tokens.contains(&campaign_token_account.mint)
    )]
    pub campaign_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token_account.owner == campaign.creator_address,
        constraint = marketplace_state.allowed_tokens.contains(&creator_token_account.mint)
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = token_mint.key() == campaign.token_mint
    )]
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
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

    #[account(mut,
        constraint = campaign_token_account.owner == campaign.key(),
        constraint = marketplace_state.allowed_tokens.contains(&campaign_token_account.mint)
    )]
    pub campaign_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = kol_token_account.owner == campaign.selected_kol,
        constraint = marketplace_state.allowed_tokens.contains(&kol_token_account.mint)
    )]
    pub kol_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token_account.owner == marketplace_state.owner,
        constraint = marketplace_state.allowed_tokens.contains(&owner_token_account.mint)
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = token_mint.key() == campaign.token_mint
    )]
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[derive(Accounts)]
pub struct CreateOpenCampaign<'info> {
    #[account(
        mut,
        seeds = [b"marketplace"],
        bump,
    )]
    pub marketplace_state: Account<'info, MarketplaceState>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        constraint = marketplace_state.allowed_tokens.contains(&token_mint.key())
    )]
    pub token_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        space = OpenCampaign::INIT_SPACE,
        seeds = [b"open_campaign", creator.key().as_ref(), &marketplace_state.campaign_counter.to_le_bytes()],
        bump,
    )]
    pub open_campaign: Account<'info, OpenCampaign>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteOpenCampaign<'info> {
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
        seeds = [b"open_campaign", open_campaign.creator_address.as_ref(), &open_campaign.counter.to_le_bytes()],
        bump,
    )]
    pub open_campaign: Account<'info, OpenCampaign>,

    #[account(
        mut,
        constraint = campaign_token_account.owner == open_campaign.key(),
        constraint = marketplace_state.allowed_tokens.contains(&campaign_token_account.mint)
    )]
    pub campaign_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token_account.owner == marketplace_state.owner,
        constraint = marketplace_state.allowed_tokens.contains(&owner_token_account.mint)
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, anchor_spl::token::Token>,
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
