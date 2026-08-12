// Site list for Lumora's built-in scraper engine (com.lumora.scraper).
//
// This script carries data, not behaviour. The engine - every per-site parser, all 86 extractors
// and the Cloudflare bypass - is compiled into the app, because none of it can be expressed as
// data: it needs a real WebView, the shared cookie store, and typed HTTP clients. What CAN be
// expressed as data is which of those sites are still up and which domain the repointable ones
// are on, and that is the half that rots. Editing this file takes a dead site out of rotation
// for everyone on the next refresh, with no app release.
//
// It is an OVERRIDE LAYER, not the source of truth:
//   - a `name` the installed app has no provider for is skipped, so this can be updated ahead
//     of an app release without breaking older installs;
//   - a site the app has but this file omits stays enabled, so a partial list degrades to
//     "everything on" rather than to "nothing works".
//
// `enabled: false` is a kill switch for something broken for everyone. It is deliberately not
// symmetric with the user's own per-site toggles in Settings: their "off" wins, so an update
// here can never switch a site back on for someone who turned it off.
//
// `baseUrl` is where the site actually lives, and it is required: a site without one is skipped
// even if `enabled` is true, because the compiled-in parser has nowhere to send a request. This
// is the point of the split - the parsing is specific to a site and has to ship in the app, but
// the address changes constantly and does not.
//
// `domainKey` marks the few sites that also keep their host in the app's settings, because their
// own code resolves a live domain at runtime and writes it back; the manifest seeds those so the
// two agree on a fresh install.
//
// `name` must match the provider's own name exactly; that is the key the app matches on.

PLUGIN = {
    id: "scraper.sites",
    label: "Streaming Site List",
    description: "Which built-in scraper sites are live, and where the repointable ones point.",
    capabilities: ["scraper_sites"],
};

var VERSION = 2;

var SITES = [
    { name: "Altadefinizione01", language: "it", enabled: true, baseUrl: "https://altadefinizione-01.fun" },
    { name: "Anikoto", language: "en", enabled: true, baseUrl: "https://anikototv.to" },
    { name: "Anime Online Ninja", language: "es", enabled: true, baseUrl: "https://ww3.animeonline.ninja" },
    { name: "AnimeAV1", language: "es", enabled: true, baseUrl: "https://animeav1.com" },
    { name: "Animefenix", language: "es", enabled: true, baseUrl: "https://animefenix2.tv" },
    { name: "AnimeFLV", language: "es", enabled: true, baseUrl: "https://www3.animeflv.net" },
    { name: "AnimeSaturn", language: "it", enabled: true, baseUrl: "https://www.animesaturn.cx" },
    { name: "AnimeUnity", language: "it", enabled: true, baseUrl: "https://www.animeunity.so" },
    { name: "AnimeWorld", language: "it", enabled: true, baseUrl: "https://www.animeworld.ac" },
    { name: "AniWorld", language: "de", enabled: true, baseUrl: "https://aniworld.to/" },
    { name: "CableVisionHD", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://www.cablevisionhd.com" },
    { name: "CB01", language: "it", enabled: true, baseUrl: "https://cb01official.uno" },
    { name: "Cine24h", language: "es", enabled: true, baseUrl: "https://cine24h.online" },
    { name: "CineCalidad", language: "es", enabled: true, baseUrl: "https://www.cinecalidad.ec" },
    { name: "CineHax", language: "es", enabled: true, baseUrl: "https://cinehax.com" },
    { name: "Cuevana 3", language: "es", enabled: true, domainKey: "cuevana", baseUrl: "https://cuevana.gs" },
    { name: "Doramasflix", language: "es", enabled: true, baseUrl: "https://doramasflix.in" },
    { name: "Einschalten", language: "de", enabled: true, baseUrl: "https://einschalten.in" },
    { name: "Fanpelis", language: "es", enabled: true, baseUrl: "https://fanpelis.to/" },
    { name: "Filmpalast", language: "de", enabled: true, baseUrl: "https://filmpalast.to" },
    { name: "FilmyOnline", language: "pl", enabled: true, baseUrl: "https://filmyonline.cc" },
    { name: "FlixLatam", language: "es", enabled: true, baseUrl: "https://flixlatam.com" },
    { name: "Frembed", language: "fr", enabled: true, baseUrl: "https://frembed.casa/" },
    { name: "FrenchAnime", language: "fr", enabled: true, baseUrl: "https://french-anime.com/" },
    { name: "FrenchManga", language: "fr", enabled: true, baseUrl: "https://w16.french-manga.net/" },
    { name: "FrenchStream", language: "fr", enabled: true, baseUrl: "https://fs16.lol/" },
    { name: "GuardaFlix", language: "it", enabled: true, baseUrl: "https://guardaplay.store" },
    { name: "GuardaSerie", language: "it", enabled: true, baseUrl: "https://guardoserie.study" },
    { name: "HDFilme", language: "de", enabled: true, baseUrl: "https://hdfilme.win" },
    { name: "IPTV Spain", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://iptv-org.github.io/iptv/languages/spa.m3u" },
    { name: "IPTV-All World", language: "en", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://iptv-org.github.io/iptv" },
    { name: "JKAnime", language: "es", enabled: true, baseUrl: "https://jkanime.net" },
    { name: "Kidraz", language: "fr", enabled: true, baseUrl: "https://www.kidraz.com/saby1jy/home/kidraz" },
    { name: "La Cartoons", language: "es", enabled: true, baseUrl: "https://www.lacartoons.com" },
    { name: "Latanime", language: "es", enabled: true, baseUrl: "https://latanime.org" },
    { name: "MAGISTV", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "MEGAKino", language: "de", enabled: true, baseUrl: "https://megakino12.com" },
    { name: "MKissa", language: "en", enabled: true, baseUrl: "https://mkissa.to/anime" },
    { name: "Moflix", language: "de", enabled: true, domainKey: "moflix", baseUrl: "https://moflix-stream.xyz" },
    { name: "PelisflixHD", language: "es", enabled: true, baseUrl: "https://pelisflixhd.win" },
    { name: "Pelisplusto", language: "es", enabled: true, baseUrl: "https://pelisplus.to" },
    { name: "Pelota Libre TV", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://pelotalibretvhd.live" },
    { name: "Pluto TV Ar", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "Pluto TV De", language: "de", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "Pluto TV Es", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "Pluto TV FR", language: "fr", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "Pluto TV It", language: "it", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "Pluto TV MX", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "Pluto TV Us", language: "en", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://raw.githubusercontent.com" },
    { name: "Poseidonhd2", language: "es", enabled: true, domainKey: "poseidon", baseUrl: "https://www.poseidonhd2.co" },
    { name: "Ridomovies", language: "en", enabled: true, baseUrl: "https://ridomovies.tv/" },
    { name: "SerienStream", language: "de", enabled: true, domainKey: "serienstream", baseUrl: "https://s.to" },
    { name: "Series Turcas", language: "es", enabled: true, baseUrl: "https://tbg.seriesturcastv.to" },
    { name: "SeriesFlix", language: "es", enabled: true, baseUrl: "https://seriesflixhd.lol" },
    { name: "SFlix", language: "en", enabled: true, baseUrl: "https://sflix.to/" },
    { name: "SoloLatino", language: "es", enabled: true, baseUrl: "https://sololatino.net" },
    { name: "StreamingCommunity", language: "it", enabled: true, domainKey: "streamingcommunity", baseUrl: "https://streamingunity.cc" },
    { name: "StreamingCommunity EN", language: "en", enabled: true, domainKey: "streamingcommunity", baseUrl: "https://streamingunity.cc" },
    { name: "TioAnime", language: "es", enabled: true, baseUrl: "https://tioanime.com" },
    { name: "Tv Libre Futbol", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://www.librefutbol2.com" },
    { name: "TvporinternetHD", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode.", baseUrl: "https://www.tvporinternet2.com" },
    { name: "Wiflix", language: "fr", enabled: true, baseUrl: "https://flemmix.team/" },
    { name: "Zaluknij", language: "pl", enabled: true, baseUrl: "https://zaluknij.cc" },
];

// The host reads this back as a JSON string: it crosses the bridge once, deterministically,
// where a nested array of objects is the one shape that does not round-trip reliably.
function sites(host) {
    return JSON.stringify({ version: VERSION, sites: SITES });
}
