from __init__ import _maps_for_nodes, _replace_text


def main():
    ubi = {
        "id": "5eb99377-dbfd-4448-b8fb-271c418dd296",
        "name": "Ubi",
        "sort-name": "Ubi",
        "aliases": [
            {"name": "Ubi of Ces Cru", "sort-name": "Ubi of Ces Cru", "type": "Search hint"},
        ],
    }
    tech = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Tech N9ne",
        "sort-name": "Tech N9ne",
        "aliases": [],
    }
    track_node = {
        "artist-credit": [
            {"name": "Tech N9ne", "artist": tech, "joinphrase": " feat. "},
            {"name": "Ubiquitous", "artist": ubi, "joinphrase": ""},
        ],
        "recording": {
            "artist-credit": [
                {"name": "Tech N9ne", "artist": tech, "joinphrase": " feat. "},
                {"name": "Ubiquitous", "artist": ubi, "joinphrase": ""},
            ]
        },
    }
    names, sorts, canonical_names, canonical_sorts = _maps_for_nodes(track_node)
    assert names["Ubiquitous"] == "Ubi"
    assert names["Ubi of Ces Cru"] == "Ubi"
    assert _replace_text("Tech N9ne feat. Ubiquitous", names, canonical_names) == "Tech N9ne feat. Ubi"
    assert _replace_text("Song (ft. Ubi of Ces Cru)", names, canonical_names) == "Song (ft. Ubi)"
    assert _replace_text("Ubiquitousness", names, canonical_names) == "Ubiquitousness"
    assert sorts["Ubiquitous"] == "Ubi"

    # Regression: short aliases that are part of the canonical name must not
    # recursively expand inside an already-correct canonical artist name.
    krizz = {
        "id": "eacc6d9c-199e-45fb-960b-e21fa503f82b",
        "name": "Krizz Kaliko",
        "sort-name": "Kaliko, Krizz",
        "aliases": [
            {"name": "Kaliko", "sort-name": "Kaliko"},
            {"name": "Big Krizz Kaliko", "sort-name": "Big Krizz Kaliko"},
            {"name": "Krizz Kalico", "sort-name": "Krizz Kalico"},
        ],
    }
    krizz_node = {
        "artist-credit": [
            {"name": "Krizz Kaliko", "artist": krizz, "joinphrase": ""},
        ]
    }
    k_names, _, k_canonical, _ = _maps_for_nodes(krizz_node)
    assert k_names["Kaliko"] == "Krizz Kaliko"
    assert _replace_text("Krizz Kaliko", k_names, k_canonical) == "Krizz Kaliko"
    assert _replace_text("Kaliko", k_names, k_canonical) == "Krizz Kaliko"
    assert _replace_text("feat. Kaliko", k_names, k_canonical) == "feat. Krizz Kaliko"
    assert _replace_text("Big Krizz Kaliko", k_names, k_canonical) == "Krizz Kaliko"
    assert _replace_text("Krizz Kalico", k_names, k_canonical) == "Krizz Kaliko"

    # Generic regression: a short alias must also not expand inside a different
    # linked artist's canonical name.
    artist_a = {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "name": "Kid Rock",
        "sort-name": "Kid Rock",
        "aliases": [{"name": "Rock", "sort-name": "Rock"}],
    }
    artist_b = {
        "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "name": "Jay Rock",
        "sort-name": "Jay Rock",
        "aliases": [],
    }
    cross_node = {
        "artist-credit": [
            {"name": "Kid Rock", "artist": artist_a, "joinphrase": " & "},
            {"name": "Jay Rock", "artist": artist_b, "joinphrase": ""},
        ]
    }
    c_names, _, c_canonical, _ = _maps_for_nodes(cross_node)
    assert _replace_text("Jay Rock", c_names, c_canonical) == "Jay Rock"
    assert _replace_text("Rock", c_names, c_canonical) == "Kid Rock"

    print("All helper tests passed.")


if __name__ == "__main__":
    main()