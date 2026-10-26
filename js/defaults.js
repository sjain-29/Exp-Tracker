// Built-in categories, account types and the icon/colour choices offered in the UI.

export const EXPENSE_DEFAULTS = [
  ['food', 'Food', 'utensils', '#F97316'],
  ['travel', 'Travel', 'plane', '#0EA5E9'],
  ['medicines', 'Medicines', 'pill', '#EF4444'],
  ['vehicle', 'Vehicle', 'car', '#64748B'],
  ['phone_pc', 'Phone & PC', 'smartphone', '#6366F1'],
  ['lifestyle', 'Lifestyle', 'sparkles', '#D946EF'],
  ['shopping', 'Shopping', 'shopping-bag', '#EC4899'],
  ['bills', 'Bills & Utilities', 'receipt', '#EAB308'],
  ['rent', 'Rent & Housing', 'house', '#8B5CF6'],
  ['education', 'Education', 'graduation-cap', '#3B82F6'],
  ['entertainment', 'Entertainment', 'clapperboard', '#F43F5E'],
  ['personal_care', 'Personal Care', 'heart-pulse', '#14B8A6'],
  ['groceries', 'Groceries', 'shopping-cart', '#22C55E'],
  ['other_exp', 'Other', 'circle-ellipsis', '#94A3B8']
];

export const INCOME_DEFAULTS = [
  ['salary', 'Salary', 'briefcase', '#10B981'],
  ['family', 'Family', 'users', '#06B6D4'],
  ['gifts', 'Gifts', 'gift', '#F472B6'],
  ['freelance', 'Freelance / Side Income', 'laptop', '#8B5CF6'],
  ['business', 'Business Income', 'store', '#F59E0B'],
  ['interest', 'Interest', 'percent', '#22C55E'],
  ['refunds', 'Refunds', 'undo-2', '#0EA5E9'],
  ['others_inc', 'Others', 'coins', '#94A3B8']
];

/** Deterministic IDs make seeding idempotent if two devices sign in at once. */
export function defaultCategoryRecords(now) {
  const out = {};
  EXPENSE_DEFAULTS.forEach(([id, name, icon, color], i) => {
    out['exp_' + id] = { name, type: 'expense', icon, color, builtIn: true, archived: false, sortOrder: i, createdAt: now, updatedAt: now };
  });
  INCOME_DEFAULTS.forEach(([id, name, icon, color], i) => {
    out['inc_' + id] = { name, type: 'income', icon, color, builtIn: true, archived: false, sortOrder: i, createdAt: now, updatedAt: now };
  });
  return out;
}

export const ACCOUNT_TYPES = [
  { id: 'savings', label: 'Savings', icon: 'piggy-bank' },
  { id: 'current', label: 'Current', icon: 'building-2' },
  { id: 'salary', label: 'Salary', icon: 'landmark' },
  { id: 'cash', label: 'Cash', icon: 'banknote' },
  { id: 'credit_card', label: 'Credit Card', icon: 'credit-card' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'other', label: 'Other', icon: 'coins' }
];
export const accountType = (id) => ACCOUNT_TYPES.find((t) => t.id === id) || ACCOUNT_TYPES[6];
export const isLiability = (acc) => acc && acc.type === 'credit_card';

export const ACCOUNT_ICONS = ['landmark', 'piggy-bank', 'building-2', 'banknote', 'credit-card', 'wallet', 'smartphone', 'coins', 'hand-coins', 'briefcase'];

export const CATEGORY_ICONS = [
  'utensils', 'coffee', 'shopping-cart', 'shopping-bag', 'plane', 'train-front', 'bus', 'car', 'bike', 'fuel',
  'house', 'zap', 'droplets', 'wifi', 'smartphone', 'laptop', 'receipt', 'pill', 'stethoscope', 'heart-pulse',
  'dumbbell', 'scissors', 'shirt', 'sparkles', 'gift', 'baby', 'dog', 'graduation-cap', 'book-open', 'music',
  'gamepad-2', 'clapperboard', 'briefcase', 'store', 'users', 'percent', 'coins', 'hand-coins', 'undo-2', 'tag',
  'circle-ellipsis'
];

export const COLORS = ['#3B82F6', '#0EA5A0', '#10B981', '#22C55E', '#0EA5E9', '#38BDF8', '#6366F1', '#8B5CF6', '#D946EF',
  '#EC4899', '#F43F5E', '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#64748B'];
