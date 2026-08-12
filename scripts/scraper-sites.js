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
// `domain` only does anything on an entry that also has `domainKey` - those are the sites whose
// base host is settable at runtime. Anywhere else it would be silently inert, so it is left off
// rather than implying it would work.
//
// `name` must match the provider's own name exactly; that is the key the app matches on.

PLUGIN = {
    id: "scraper.sites",
    label: "Streaming Site List",
    description: "Which built-in scraper sites are live, and where the repointable ones point.",
    capabilities: ["scraper_sites"],
};

var VERSION = 1;

var SITES = [
    { name: "Altadefinizione01", language: "it", enabled: true },
    { name: "Anikoto", language: "en", enabled: true },
    { name: "Anime Online Ninja", language: "es", enabled: true },
    { name: "AnimeAV1", language: "es", enabled: true },
    { name: "Animefenix", language: "es", enabled: true },
    { name: "AnimeFLV", language: "es", enabled: true },
    { name: "AnimeSaturn", language: "it", enabled: true },
    { name: "AnimeUnity", language: "it", enabled: true },
    { name: "AnimeWorld", language: "it", enabled: true },
    { name: "AniWorld", language: "de", enabled: true },
    { name: "CableVisionHD", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "CB01", language: "it", enabled: true },
    { name: "Cine24h", language: "es", enabled: true },
    { name: "CineCalidad", language: "es", enabled: true },
    { name: "CineHax", language: "es", enabled: true },
    { name: "Cuevana 3", language: "es", enabled: true, domainKey: "cuevana" },
    { name: "Doramasflix", language: "es", enabled: true },
    { name: "Einschalten", language: "de", enabled: true },
    { name: "Fanpelis", language: "es", enabled: true },
    { name: "Filmpalast", language: "de", enabled: true },
    { name: "FilmyOnline", language: "pl", enabled: true },
    { name: "FlixLatam", language: "es", enabled: true },
    { name: "Frembed", language: "fr", enabled: true },
    { name: "FrenchAnime", language: "fr", enabled: true },
    { name: "FrenchManga", language: "fr", enabled: true },
    { name: "FrenchStream", language: "fr", enabled: true },
    { name: "GuardaFlix", language: "it", enabled: true },
    { name: "GuardaSerie", language: "it", enabled: true },
    { name: "HDFilme", language: "de", enabled: true },
    { name: "IPTV Spain", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "IPTV-All World", language: "en", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "JKAnime", language: "es", enabled: true },
    { name: "Kidraz", language: "fr", enabled: true },
    { name: "La Cartoons", language: "es", enabled: true },
    { name: "Latanime", language: "es", enabled: true },
    { name: "MAGISTV", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "MEGAKino", language: "de", enabled: true },
    { name: "MKissa", language: "en", enabled: true },
    { name: "Moflix", language: "de", enabled: true, domainKey: "moflix" },
    { name: "PelisflixHD", language: "es", enabled: true },
    { name: "Pelisplusto", language: "es", enabled: true },
    { name: "Pelota Libre TV", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Pluto TV Ar", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Pluto TV De", language: "de", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Pluto TV Es", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Pluto TV FR", language: "fr", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Pluto TV It", language: "it", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Pluto TV MX", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Pluto TV Us", language: "en", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Poseidonhd2", language: "es", enabled: true, domainKey: "poseidon" },
    { name: "Ridomovies", language: "en", enabled: true },
    { name: "SerienStream", language: "de", enabled: true, domainKey: "serienstream" },
    { name: "Series Turcas", language: "es", enabled: true },
    { name: "SeriesFlix", language: "es", enabled: true },
    { name: "SFlix", language: "en", enabled: true },
    { name: "SoloLatino", language: "es", enabled: true },
    { name: "StreamingCommunity", language: "it", enabled: true, domainKey: "streamingcommunity" },
    { name: "StreamingCommunity EN", language: "en", enabled: true, domainKey: "streamingcommunity" },
    { name: "TioAnime", language: "es", enabled: true },
    { name: "Tv Libre Futbol", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "TvporinternetHD", language: "es", enabled: false, note: "Live TV channels only - cannot source a film or episode." },
    { name: "Wiflix", language: "fr", enabled: true },
    { name: "Zaluknij", language: "pl", enabled: true },
];

// The host reads this back as a JSON string: it crosses the bridge once, deterministically,
// where a nested array of objects is the one shape that does not round-trip reliably.
function sites(host) {
    return JSON.stringify({ version: VERSION, sites: SITES });
}
