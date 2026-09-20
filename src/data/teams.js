export const TEAM_CODES = [
  "CSK",
  "MI",
  "RCB",
  "KKR",
  "SRH",
  "DC",
  "RR",
  "PBKS",
  "GT",
  "LSG",
]

export const TEAMS = [
  {
    code: "CSK",
    name: "Chennai Super Kings",
    primaryColor: "#facc15",
    secondaryColor: "#00539f",
  },
  {
    code: "MI",
    name: "Mumbai Indians",
    primaryColor: "#004ba0",
    secondaryColor: "#d1ab3e",
  },
  {
    code: "RCB",
    name: "Royal Challengers Bengaluru",
    primaryColor: "#d71920",
    secondaryColor: "#000000",
  },
  {
    code: "KKR",
    name: "Kolkata Knight Riders",
    primaryColor: "#3a225d",
    secondaryColor: "#d1ab3e",
  },
  {
    code: "SRH",
    name: "Sunrisers Hyderabad",
    primaryColor: "#f26522",
    secondaryColor: "#000000",
  },
  {
    code: "DC",
    name: "Delhi Capitals",
    primaryColor: "#0078bc",
    secondaryColor: "#d71920",
  },
  {
    code: "RR",
    name: "Rajasthan Royals",
    primaryColor: "#ea1a85",
    secondaryColor: "#004b87",
  },
  {
    code: "PBKS",
    name: "Punjab Kings",
    primaryColor: "#dd1f2d",
    secondaryColor: "#dcdcdc",
  },
  {
    code: "GT",
    name: "Gujarat Titans",
    primaryColor: "#1b2133",
    secondaryColor: "#c2a35d",
  },
  {
    code: "LSG",
    name: "Lucknow Super Giants",
    primaryColor: "#0057e7",
    secondaryColor: "#ff7f00",
  },
]

export const TEAM_MAP = Object.fromEntries(
  TEAMS.map((team) => [team.code, team])
)
