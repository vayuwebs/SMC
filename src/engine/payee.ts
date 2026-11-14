/**
 * Telling a person's name from a shop's name, for the rojmel.
 *
 * The rojmel prints a person by first name only, to save space in its narrow
 * column ("હસમુખભાઈને વા.મુજબ"), and a shop by its whole name ("BM સુપર
 * બજારને બિલ મુજબ"). Cutting a SHOP's name to its first word is the costly
 * mistake: "પ્રધાનમંત્રી ભારતીય જનઔષધી કેન્દ્ર" printed as "પ્રધાનમંત્રીને" says
 * nothing. Cutting a person's name is only a convenience. So a name is cut only
 * when it clearly is a person's; anything uncertain prints whole.
 *
 * In order, the first rule that decides wins:
 *   1. a shop word anywhere (સ્ટોર્સ, ટ્રેડર્સ, કેન્દ્ર, ફર્નિચર, ...)  -> shop
 *   2. a person's word: a name ending (ભાઈ, બેન, કુમાર, સિંહ, ...) or
 *      a known surname as the last word (પટેલ, સોલંકી, ...)               -> person
 *   3. a shop's opening word (ઓમ, શ્રીજી, જય, પ્રધાનમંત્રી, ન્યુ, ...)     -> shop
 *   4. anything else                                                  -> shop (printed whole)
 */

export type PayeeKind = "person" | "shop";

/** Words that make a name a business, wherever they appear. */
const SHOP_WORDS = [
  "સ્ટોર્સ", "સ્ટોર", "સ્ટોલ", "ટ્રેડર્સ", "ટ્રેડર", "ટ્રેડિંગ", "બજાર", "સુપરબજાર", "મેડીકલ", "મેડિકલ",
  "એજન્સી", "એજન્સીઝ", "એન્ટરપ્રાઈઝ", "એન્ટરપ્રાઇઝ", "એન્ટરપ્રાઇઝીસ", "એન્ટરપ્રાઈઝીસ", "ડેપો",
  "સેન્ટર", "કેન્દ્ર", "ફાર્મસી", "કંપની", "માર્ટ", "મોલ", "હાર્ડવેર", "સ્ટેશનર્સ", "સ્ટેશનરી",
  "બુકસ્ટોલ", "નોવેલ્ટી", "ઇલેક્ટ્રિક", "ઈલેક્ટ્રીક", "ઇલેક્ટ્રીક", "ઇલેક્ટ્રોનિક્સ", "ઈલેક્ટ્રોનિક્સ",
  "સાવરણીવાલા", "પ્રેસ", "પ્રિન્ટર્સ", "પ્રિન્ટીંગ", "ઝેરોક્ષ", "ઝેરોક્સ", "સ્ટીલ",
  "ઉદ્યોગ", "સોસાયટી", "મંડળ", "મંડળી", "હોસ્પિટલ", "લેબોરેટરી", "ક્લિનિક", "કટલરી", "કિરાણા",
  "કરિયાણા", "હેલ્થકેર", "ફર્નિચર", "ફર્નીચર", "ફેબ્રિકેશન", "ફેબ્રીકેશન", "વર્કસ", "વર્ક્સ",
  "સેલ્સ", "સર્વિસ", "સર્વિસીસ", "સોલ્યુશન", "સોલ્યુશન્સ", "ટ્રાવેલ્સ", "ડેરી", "ફોટો", "સ્ટુડિયો",
  "પ્લાસ્ટિક", "ગ્લાસ", "પેઇન્ટ્સ", "પેઈન્ટ્સ", "સિમેન્ટ", "ટેન્ટ", "ડેકોરેશન", "ડેકોરેટર્સ",
  "કેટરર્સ", "કેટરીંગ", "મશીનરી", "ઓટો", "મોબાઈલ", "મોબાઇલ", "કોમ્પ્યુટર", "કોમ્પ્યુટર્સ",
  "ગારમેન્ટ", "ગારમેન્ટ્સ", "ક્લોથ", "કાપડ", "ભંડાર", "એમ્પોરિયમ", "હાઉસ", "પેલેસ", "શોપ",
  "દુકાન", "પેઢી", "ગ્રુપ", "ઇન્ડસ્ટ્રીઝ", "ઈન્ડસ્ટ્રીઝ", "એસોસિએટ્સ", "બ્રધર્સ", "સન્સ",
  "કોર્પોરેશન", "લિમિટેડ", "પ્રા.લિ", "બેકરી", "સ્વીટ", "ફરસાણ", "નાસ્તા", "હોટલ", "રેસ્ટોરન્ટ",
  "ઇન્ટરપ્રાઇઝ", "ટેલર્સ", "ટેલર", "જ્વેલર્સ", "ઓપ્ટિકલ્સ", "ગેસ", "પેટ્રોલ", "પંપ",
];

const SHOP_WORDS_LATIN = [
  "store", "stores", "stall", "trader", "traders", "trading", "enterprise", "enterprises", "agency",
  "agencies", "medical", "medicals", "mart", "mall", "center", "centre", "kendra", "bazar", "bazaar",
  "press", "printers", "printing", "hardware", "co", "company", "pvt", "ltd", "llp", "super",
  "stationery", "stationers", "xerox", "furniture", "electric", "electricals", "electronics",
  "works", "sales", "service", "services", "solutions", "travels", "dairy", "studio", "industries",
  "brothers", "sons", "corporation", "shop", "emporium", "house", "palace", "pharmacy", "healthcare",
  "cutlery", "novelty", "kirana", "bakery", "sweets", "hotel", "restaurant", "tailors", "jewellers",
];

/**
 * Words a business name often STARTS with: a deity, a blessing, a brand, a
 * scheme. "ઓમ ઇલેક્ટ્રિકલ", "શ્રીજી ફર્નિચર", "પ્રધાનમંત્રી જનઔષધી".
 * They decide only when no person's word does, since "ઓમ પટેલ" is a person.
 */
const SHOP_OPENINGS = [
  "ઓમ", "ૐ", "શ્રીજી", "શ્રીનાથજી", "જય", "જયશ્રી", "હરિ", "હરિઓમ", "શ્રીરામ", "રામ", "સાંઈ",
  "સાઈ", "સાંઇ", "ગણેશ", "ગણપતિ", "મહાદેવ", "શિવ", "શિવમ", "અંબિકા", "અંબે", "અંબાજી", "ચામુંડા",
  "ખોડિયાર", "ખોડીયાર", "મોમાઈ", "બહુચર", "ઉમિયા", "મહાલક્ષ્મી", "લક્ષ્મી", "દ્વારકાધીશ",
  "જલારામ", "બાલાજી", "તિરૂપતિ", "તિરુપતિ", "ગુરુકૃપા", "માતૃકૃપા", "કૃપા", "પ્રધાનમંત્રી",
  "પ્રધાન", "સરકારી", "ગુજરાત", "ભારત", "ભારતીય", "ન્યુ", "ન્યૂ", "નવી", "નવું", "રોયલ", "સુપર",
  "ગોલ્ડન", "સ્ટાર", "સિટી", "ઇન્ડિયા", "ઈન્ડિયા", "મા", "માં", "આઈ", "આઇ",
  "om", "shree", "shri", "shreeji", "shriji", "jay", "jai", "sai", "new", "royal", "pradhan",
];

/** Endings of Gujarati given names and fathers' names. */
const PERSON_ENDINGS = [
  "ભાઈ", "ભાઇ", "બેન", "બહેન", "કુમાર", "કુમારી", "સિંહ", "સિંગ", "લાલ", "ચંદ", "ચંદ્ર", "દાસ",
  "રાય", "રાજ", "પ્રસાદ", "શંકર", "નાથ", "દેવ", "વિંદ", "ગીરી", "ગિરી", "પુરી", "દત્ત",
];

/** Common Gujarati surnames, matched as the last word of a name. */
const SURNAMES = [
  "પટેલ", "શાહ", "મહેતા", "દેસાઈ", "દેસાઇ", "જોષી", "જોશી", "ત્રિવેદી", "ભટ્ટ", "પંડ્યા", "વ્યાસ",
  "દવે", "રાવલ", "ઠાકર", "પરમાર", "સોલંકી", "ચૌહાણ", "રાઠોડ", "વાઘેલા", "ઝાલા", "જાડેજા", "ગોહિલ",
  "ચાવડા", "ડાભી", "મકવાણા", "વસાવા", "ગામીત", "ચૌધરી", "રબારી", "ભરવાડ", "ઠાકોર", "ઠાકોરે",
  "હરિજન", "વણકર", "રોહિત", "સોની", "પંચાલ", "મિસ્ત્રી", "પ્રજાપતિ", "નાયી", "વાળંદ", "બારોટ",
  "રાજપૂત", "રાજપુત", "ભોઈ", "માલી", "દરજી", "કડિયા", "સુથાર", "લુહાર", "મોદી", "શેખ", "પઠાણ",
  "મલેક", "સૈયદ", "મન્સુરી", "વોરા", "ખાન", "ડામોર", "બારીઆ", "બારિયા", "પગી", "તડવી", "ભીલ",
  "નાયક", "નાયકા", "ગઢવી", "આહીર", "કોળી", "રાણા", "પાઠક", "ઉપાધ્યાય", "આચાર્ય", "શ્રીમાળી",
  "patel", "shah", "mehta", "desai", "joshi", "parmar", "solanki", "chauhan", "rathod", "thakor",
];

/** The honorific a name may open with; it says nothing about which kind it is. */
const HONORIFIC = /^(શ્રીમતી|શ્રી|શ્રીમાન|કુ\.|સ્વ\.|shri|shree|smt\.?|mr\.?|mrs\.?)\s+/i;

function words(name: string): string[] {
  return name
    .trim()
    .replace(HONORIFIC, "")
    .split(/[\s,]+/)
    .map((word) => word.replace(/[().]+$/g, "").replace(/^[().]+/g, ""))
    .filter((word) => word !== "");
}

function isShopWord(word: string): boolean {
  const lower = word.toLowerCase();
  if (SHOP_WORDS_LATIN.includes(lower)) return true;
  // Gujarati words take endings ("સ્ટોર્સમાંથી"), so a shop word may start one.
  return SHOP_WORDS.some((shop) => word === shop || (shop.length >= 3 && word.startsWith(shop)));
}

function isPersonWord(word: string, isLast: boolean): boolean {
  const lower = word.toLowerCase();
  if (isLast && SURNAMES.includes(lower)) return true;
  // A name ending needs a name before it: "ભાઈ" alone is not a person.
  return PERSON_ENDINGS.some((ending) => word.length > ending.length + 1 && word.endsWith(ending));
}

/** Person or shop - see the rules at the top of this file. */
export function classifyPayee(name: string): PayeeKind {
  const all = words(name);
  if (all.length === 0) return "shop";

  if (all.some(isShopWord)) return "shop";
  // Two words written together ("સુપર બજાર") count as one shop word too.
  for (let i = 0; i + 1 < all.length; i += 1) {
    if (isShopWord(`${all[i]}${all[i + 1]}`)) return "shop";
  }

  if (all.some((word, index) => isPersonWord(word, index === all.length - 1 && all.length > 1))) {
    return "person";
  }

  return "shop";
}

export function isShopVendor(name: string): boolean {
  return classifyPayee(name) === "shop";
}

/**
 * How the rojmel names a payee: a person by first name, a shop in full - with
 * the honorific a person's name opened with left off, as the client writes it.
 */
export function rojmelPayeeName(name: string): string {
  const trimmed = name.trim();
  if (classifyPayee(trimmed) === "shop") return trimmed;
  return words(trimmed)[0] ?? trimmed;
}
