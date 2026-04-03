const { Client } = require('pg');

const SQL = `
CREATE OR REPLACE FUNCTION update_portfolio_on_close(
  p_user_id UUID,
  p_pnl     DECIMAL,
  p_is_demo BOOLEAN,
  p_won     BOOLEAN
) RETURNS VOID AS $$
BEGIN
  UPDATE portfolio
  SET
    realized_pnl     = realized_pnl + p_pnl,
    available_capital = available_capital + p_pnl,
    win_count        = win_count + CASE WHEN p_won THEN 1 ELSE 0 END,
    loss_count       = loss_count + CASE WHEN p_won THEN 0 ELSE 1 END,
    updated_at       = NOW()
  WHERE user_id = p_user_id AND is_demo = p_is_demo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
`;

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:ANXMFn2dkHdzWTR4@db.thuamsmvqdngemdkrftk.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query(SQL);
  console.log('update_portfolio_on_close RPC created successfully');
  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
