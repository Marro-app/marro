export const BRANDS = {
  spotify:        {bg:"#1DB954", fg:"#fff", letter:"S",  shape:"music"},
  "apple music":  {bg:"#FA243C", fg:"#fff", letter:"♪",  shape:"music"},
  netflix:        {bg:"#E50914", fg:"#fff", letter:"N",  shape:""},
  hulu:           {bg:"#1CE783", fg:"#000", letter:"h",  shape:""},
  "disney+":      {bg:"#0c2340", fg:"#fff", letter:"D",  shape:""},
  "disney plus":  {bg:"#0c2340", fg:"#fff", letter:"D",  shape:""},
  max:            {bg:"#002BE7", fg:"#fff", letter:"M",  shape:""},
  "hbo max":      {bg:"#002BE7", fg:"#fff", letter:"M",  shape:""},
  "youtube":      {bg:"#FF0000", fg:"#fff", letter:"▶",  shape:""},
  "youtube premium":{bg:"#FF0000",fg:"#fff",letter:"▶",  shape:""},
  "amazon prime": {bg:"#00A8E0", fg:"#fff", letter:"a",  shape:""},
  "amazon":       {bg:"#FF9900", fg:"#fff", letter:"a",  shape:""},
  "apple tv+":    {bg:"#1c1c1e", fg:"#fff", letter:"tv", shape:""},
  "apple tv":     {bg:"#1c1c1e", fg:"#fff", letter:"tv", shape:""},
  "icloud":       {bg:"#3395FF", fg:"#fff", letter:"☁",  shape:""},
  "apple one":    {bg:"#1c1c1e", fg:"#fff", letter:"A",  shape:""},
  "paramount+":   {bg:"#0064FF", fg:"#fff", letter:"P",  shape:""},
  "espn+":        {bg:"#CC0000", fg:"#fff", letter:"E",  shape:""},
  "uworld":       {bg:"#003366", fg:"#fff", letter:"UW", shape:""},
  "amboss":       {bg:"#D0021B", fg:"#fff", letter:"A",  shape:""},
  "anki":         {bg:"#1F8EFA", fg:"#fff", letter:"A",  shape:""},
  "sketchy":      {bg:"#E8763A", fg:"#fff", letter:"Sk", shape:""},
  "boards & beyond":{bg:"#002D72",fg:"#fff",letter:"B&B",shape:""},
  "first aid":    {bg:"#C41230", fg:"#fff", letter:"FA", shape:""},
  "notion":       {bg:"#1a1a1a", fg:"#fff", letter:"N",  shape:""},
  "dropbox":      {bg:"#0061FF", fg:"#fff", letter:"⬡",  shape:""},
  "google one":   {bg:"#4285F4", fg:"#fff", letter:"G",  shape:""},
  "google":       {bg:"#4285F4", fg:"#fff", letter:"G",  shape:""},
  "microsoft 365":{bg:"#D83B01", fg:"#fff", letter:"M",  shape:""},
  "office 365":   {bg:"#D83B01", fg:"#fff", letter:"O",  shape:""},
  "adobe":        {bg:"#FF0000", fg:"#fff", letter:"Ai", shape:""},
  "chatgpt":      {bg:"#10A37F", fg:"#fff", letter:"G",  shape:""},
  "openai":       {bg:"#10A37F", fg:"#fff", letter:"⊕",  shape:""},
  "claude":       {bg:"#C67B5A", fg:"#fff", letter:"C",  shape:""},
  "github":       {bg:"#24292e", fg:"#fff", letter:"GH", shape:""},
  "figma":        {bg:"#F24E1E", fg:"#fff", letter:"F",  shape:""},
  "slack":        {bg:"#4A154B", fg:"#fff", letter:"S",  shape:""},
  "zoom":         {bg:"#2D8CFF", fg:"#fff", letter:"Z",  shape:""},
  "duolingo":     {bg:"#58CC02", fg:"#fff", letter:"D",  shape:""},
  "calm":         {bg:"#00B4D8", fg:"#fff", letter:"C",  shape:""},
  "headspace":    {bg:"#F47D31", fg:"#fff", letter:"H",  shape:""},
  "strava":       {bg:"#FC4C02", fg:"#fff", letter:"S",  shape:""},
  "peloton":      {bg:"#111111", fg:"#fff", letter:"P",  shape:""},
  "nytimes":      {bg:"#121212", fg:"#fff", letter:"NY", shape:""},
  "new york times":{bg:"#121212",fg:"#fff", letter:"NY", shape:""},
  "wsj":          {bg:"#004685", fg:"#fff", letter:"W",  shape:""},
  "twitter":      {bg:"#000000", fg:"#fff", letter:"X",  shape:""},
  "x":            {bg:"#000000", fg:"#fff", letter:"X",  shape:""},
  "instagram":    {bg:"#E1306C", fg:"#fff", letter:"ig", shape:""},
  "reddit":       {bg:"#FF4500", fg:"#fff", letter:"R",  shape:""},
  "twitch":       {bg:"#9146FF", fg:"#fff", letter:"T",  shape:""},
};

export const BRAND_DOMAINS = {
  spotify:"spotify.com",netflix:"netflix.com",hulu:"hulu.com",max:"max.com",
  "disney+":"disneyplus.com","disney plus":"disneyplus.com","hbo max":"max.com",
  youtube:"youtube.com","youtube premium":"youtube.com","amazon prime":"amazon.com",
  amazon:"amazon.com","apple tv+":"tv.apple.com","apple tv":"tv.apple.com",
  "apple music":"music.apple.com",icloud:"icloud.com","apple one":"apple.com",
  "paramount+":"paramountplus.com","espn+":"espn.com",uworld:"uworld.com",
  amboss:"amboss.com",anki:"apps.ankiweb.net",sketchy:"sketchy.com",
  "boards & beyond":"boardsbeyond.com","first aid":"firstaidteam.com",
  notion:"notion.so",dropbox:"dropbox.com","google one":"one.google.com",
  google:"google.com","microsoft 365":"microsoft.com","office 365":"microsoft.com",
  adobe:"adobe.com",chatgpt:"chatgpt.com",openai:"openai.com",claude:"claude.ai",
  github:"github.com",figma:"figma.com",slack:"slack.com",zoom:"zoom.us",
  duolingo:"duolingo.com",calm:"calm.com",headspace:"headspace.com",
  strava:"strava.com",peloton:"onepeloton.com",nytimes:"nytimes.com",
  "new york times":"nytimes.com",wsj:"wsj.com",twitter:"x.com",x:"x.com",
  instagram:"instagram.com",reddit:"reddit.com",twitch:"twitch.tv",
};

export function getBrandDomain(name) {
  if(!name) return null;
  const k = name.toLowerCase().trim();
  if(BRAND_DOMAINS[k]) return BRAND_DOMAINS[k];
  const match = Object.entries(BRAND_DOMAINS).find(([bk])=>k.includes(bk)||bk.includes(k));
  return match?.[1]||null;
}

export function getBrand(name) {
  if(!name) return null;
  const k = name.toLowerCase().trim().replace(/[^a-z0-9+ ]/g,"");
  // Exact match
  if(BRANDS[k]) return BRANDS[k];
  // Partial match (brand key in name or name in brand key)
  const partial = Object.entries(BRANDS).find(([bk])=>k.includes(bk)||bk.includes(k));
  if(partial) return partial[1];
  // Word match (any word in name matches a brand key word)
  const words = k.split(/\s+/);
  const wordMatch = Object.entries(BRANDS).find(([bk])=>{
    const bWords = bk.split(/\s+/);
    return words.some(w=>w.length>2 && bWords.some(bw=>bw.includes(w)||w.includes(bw)));
  });
  return wordMatch?.[1] || null;
}

