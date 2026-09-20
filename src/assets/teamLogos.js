import cskLogo from "./LOGOS/csk.jpg"
import dcLogo from "./LOGOS/dc.jpg"
import gtLogo from "./LOGOS/gt.jpg"
import kkrLogo from "./LOGOS/kkr.jpg"
import lsgLogo from "./LOGOS/lsg.png"
import miLogo from "./LOGOS/mi.png"
import pbksLogo from "./LOGOS/pbks.png"
import rcbLogo from "./LOGOS/rcb.jpg"
import rrLogo from "./LOGOS/rr.jpg"
import srhLogo from "./LOGOS/srh.jpg"

export const TEAM_LOGOS = {
  CSK: cskLogo,
  MI: miLogo,
  RCB: rcbLogo,
  KKR: kkrLogo,
  SRH: srhLogo,
  DC: dcLogo,
  RR: rrLogo,
  PBKS: pbksLogo,
  GT: gtLogo,
  LSG: lsgLogo,
}

export const getTeamLogo = (code) => TEAM_LOGOS[code] || null
