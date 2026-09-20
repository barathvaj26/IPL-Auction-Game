/**
 * Pure auction domain utilities
 */

export const getBidIncrement = (currentBid) => {
  if (currentBid < 1.0) return 0.1 // 10 Lakhs
  if (currentBid < 2.0) return 0.2 // 20 Lakhs
  if (currentBid < 5.0) return 0.25 // 25 Lakhs
  if (currentBid < 10.0) return 0.5 // 50 Lakhs
  if (currentBid < 20.0) return 1.0 // 1 Crore
  return 2.0 // 2 Crores
}

export const roundCurrency = (val) => {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

export const getNextBid = (currentBid) => {
  const inc = getBidIncrement(currentBid)
  return roundCurrency(currentBid + inc)
}

export const formatCurrency = (amountInCr) => {
  if (amountInCr === undefined || amountInCr === null) return "₹ 0"
  const val = Number(amountInCr)
  if (isNaN(val) || val === 0) return "₹ 0"
  
  if (val < 1.0) {
    const lakhs = Math.round(val * 100)
    return `₹ ${lakhs} L`
  }
  
  // Format with up to 2 decimal digits, trimming trailing zeros if clean integer
  const formatted = val.toFixed(2).replace(/\.?0+$/, "")
  return `₹ ${formatted} Cr`
}

export const canTeamBid = (purse, currentBid, hasBid = true) => {
  const nextBid = hasBid ? getNextBid(currentBid) : currentBid
  return purse >= nextBid
}
