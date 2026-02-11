// Default categories seeded for every new tenant
// Users can edit/delete these freely — they're just starting points

export interface DefaultCategory {
  emoji: string;
  name: string;
  expenseType: 'operating' | 'cogs';
  homeOfficeEligible: boolean;
  isSystem?: boolean;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // --- Operating Expenses ---
  { emoji: '📎', name: 'Office Supplies', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🛡️', name: 'Business Insurance', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '✈️', name: 'Travel', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '💻', name: 'Software & Subscriptions', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🖥️', name: 'Hardware (under $500)', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🎓', name: 'Continuing Education', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🤝', name: 'Contractors', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '⚖️', name: 'Professional Fees', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '📜', name: 'Business Licenses & Fees', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🎁', name: 'Gifts to Clients', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🍽️', name: 'Meals', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '📣', name: 'Advertising & Marketing', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '💳', name: 'Merchant Fees', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🏦', name: 'Bank Fees', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '💰', name: 'Interest Paid', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '🌍', name: 'Web Expense', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '📋', name: 'Equipment Rental', expenseType: 'operating', homeOfficeEligible: false },
  { emoji: '📬', name: 'Postage & Delivery', expenseType: 'operating', homeOfficeEligible: false },

  // --- COGS ---
  { emoji: '🔧', name: 'Small Tools', expenseType: 'cogs', homeOfficeEligible: false },
  { emoji: '📦', name: 'General Supplies', expenseType: 'cogs', homeOfficeEligible: false },

  // --- Home Office Eligible (all Operating) ---
  { emoji: '🔨', name: 'Repairs', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '🏠', name: 'Rent', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '📞', name: 'Telephone', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '🌐', name: 'Internet', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '🏡', name: 'Homeowners Insurance', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '🔑', name: 'Renters Insurance', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '⚡', name: 'Gas / Electric', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '💧', name: 'Water', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '🏛️', name: 'Mortgage Interest', expenseType: 'operating', homeOfficeEligible: true },
  { emoji: '🏷️', name: 'Property Taxes', expenseType: 'operating', homeOfficeEligible: true },
];

// System category — always seeded, cannot be deleted
export const UNCATEGORIZED_CATEGORY: DefaultCategory = {
  emoji: '📂',
  name: 'Uncategorized',
  expenseType: 'operating',
  homeOfficeEligible: false,
  isSystem: true,
};