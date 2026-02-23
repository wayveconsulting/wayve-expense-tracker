#!/bin/bash
# =============================================================
# Task 3: Backend — Home Office Effective Amounts
# Clean sed replacements only. Frontend done manually after.
# =============================================================

set -e

echo "=== 3A: api/expenses/index.ts ==="

# Add getEffectiveAmount helper before the category breakdown
sed -i '/  const categoryTotals = new Map/i\
  // Helper: get effective (deductible) amount for an expense\
  function getEffectiveAmount(e: { amount: number; isHomeOffice?: boolean | null; homeOfficePercent?: number | null }): number {\
    if (e.isHomeOffice \&\& e.homeOfficePercent) {\
      return Math.round(e.amount * e.homeOfficePercent / 100)\
    }\
    return e.amount\
  }\
' api/expenses/index.ts

# Fix totalAmount to use effective amounts
sed -i 's/const totalAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0)/const totalAmount = filteredExpenses.reduce((sum, e) => sum + getEffectiveAmount(e), 0)/' api/expenses/index.ts

# Fix category breakdown — existing total accumulation
sed -i 's/existing.total += expense.amount/existing.total += getEffectiveAmount(expense)/' api/expenses/index.ts

# Fix category breakdown — initial total on new entry
sed -i '/categoryTotals.set(key, {/,/})/s/total: expense.amount/total: getEffectiveAmount(expense)/' api/expenses/index.ts

echo "  Done."


echo "=== 3F: api/reports/annual.ts ==="

# Add getEffectiveAmount helper before monthly totals
sed -i '/  const monthlyTotals = new Array/i\
  // Helper: get effective (deductible) amount for an expense\
  function getEffectiveAmount(e: { amount: number; isHomeOffice?: boolean | null; homeOfficePercent?: number | null }): number {\
    if (e.isHomeOffice \&\& e.homeOfficePercent) {\
      return Math.round(e.amount * e.homeOfficePercent / 100)\
    }\
    return e.amount\
  }\
' api/reports/annual.ts

# Fix monthly totals
sed -i 's/monthlyTotals\[month\] += exp.amount/monthlyTotals[month] += getEffectiveAmount(exp)/' api/reports/annual.ts

# Fix category totals accumulation
sed -i 's/existing.amount += exp.amount/existing.amount += getEffectiveAmount(exp)/' api/reports/annual.ts

# Fix totalSpent grand total
sed -i 's/const totalSpent = yearExpenses.reduce((sum, e) => sum + e.amount, 0)/const totalSpent = yearExpenses.reduce((sum, e) => sum + getEffectiveAmount(e), 0)/' api/reports/annual.ts

echo "  Done."


echo "=== 3G: api/reports/quarterly.ts ==="

# Add isHomeOffice and homeOfficePercent to the select
sed -i '/      categoryEmoji: categories.emoji,/a\
      isHomeOffice: expenses.isHomeOffice,\
      homeOfficePercent: expenses.homeOfficePercent,' api/reports/quarterly.ts

# Add getEffectiveAmount helper before the matrix
sed -i '/  const matrix = new Map/i\
  // Helper: get effective (deductible) amount for an expense\
  function getEffectiveAmount(e: { amount: number; isHomeOffice?: boolean | null; homeOfficePercent?: number | null }): number {\
    if (e.isHomeOffice \&\& e.homeOfficePercent) {\
      return Math.round(e.amount * e.homeOfficePercent / 100)\
    }\
    return e.amount\
  }\
' api/reports/quarterly.ts

# Fix quarter accumulation and total accumulation
sed -i 's/row\[qKey\] += expense.amount/row[qKey] += getEffectiveAmount(expense)/' api/reports/quarterly.ts
sed -i 's/row\.total += expense\.amount/row.total += getEffectiveAmount(expense)/' api/reports/quarterly.ts

echo "  Done."


echo "=== 3I: api/categories/index.ts — SQL CASE WHEN ==="

sed -i "s|total: sql<number>\`coalesce(sum(\${expenses.amount}), 0)\`.as('total')|total: sql<number>\`coalesce(sum(CASE WHEN \${expenses.isHomeOffice} = true AND \${expenses.homeOfficePercent} IS NOT NULL THEN ROUND(\${expenses.amount} * \${expenses.homeOfficePercent} / 100) ELSE \${expenses.amount} END), 0)\`.as('total')|" api/categories/index.ts

echo "  Done."


echo ""
echo "=== BACKEND CHANGES COMPLETE ==="
echo ""
echo "Files modified:"
echo "  - api/expenses/index.ts"
echo "  - api/reports/annual.ts"
echo "  - api/reports/quarterly.ts"
echo "  - api/categories/index.ts"
echo ""
echo "Verify with: git diff"
echo "Then we'll do the frontend changes manually."
