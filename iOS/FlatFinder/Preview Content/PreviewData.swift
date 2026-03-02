import Foundation

enum PreviewData {
    static let listing = Listing(
        id: 1,
        externalId: "sreality_12345",
        source: "sreality",
        propertyType: "flat",
        transactionType: "rent",
        title: "Pronájem bytu 2+kk 55 m²",
        description: "Krásný byt v centru Prahy s výhledem na Vltavu. Byt je plně vybavený a připravený k nastěhování.",
        price: 18500,
        currency: "CZK",
        priceNote: "+ 3500 Kč poplatky",
        address: "Vinohradská 123, Praha 2",
        city: "Praha",
        district: "Praha 2",
        region: "Hlavní město Praha",
        latitude: 50.0755,
        longitude: 14.4378,
        sizeM2: 55,
        layout: "2+kk",
        floor: 3,
        totalFloors: 5,
        condition: "good",
        construction: "brick",
        ownership: "personal",
        furnishing: "furnished",
        energyRating: "C",
        amenities: ["balkon", "výtah", "sklep", "parkování"],
        imageUrls: [
            "https://picsum.photos/800/600?random=1",
            "https://picsum.photos/800/600?random=2",
            "https://picsum.photos/800/600?random=3"
        ],
        thumbnailUrl: "https://picsum.photos/400/300?random=1",
        sourceUrl: "https://www.sreality.cz/detail/pronajem/byt/12345",
        listedAt: "2025-12-01 10:30:00",
        scrapedAt: "2025-12-01 12:00:00",
        createdAt: "2025-12-01 12:00:00",
        isActive: 1,
        deactivatedAt: nil
    )

    static let listing2 = Listing(
        id: 2,
        externalId: "bezrealitky_67890",
        source: "bezrealitky",
        propertyType: "flat",
        transactionType: "sale",
        title: "Prodej bytu 3+1 78 m²",
        description: "Prostorný byt v klidné části Brna.",
        price: 4_500_000,
        currency: "CZK",
        priceNote: nil,
        address: "Kotlářská 15, Brno",
        city: "Brno",
        district: nil,
        region: "Jihomoravský kraj",
        latitude: 49.1951,
        longitude: 16.6068,
        sizeM2: 78,
        layout: "3+1",
        floor: 2,
        totalFloors: 4,
        condition: "before_renovation",
        construction: "panel",
        ownership: "cooperative",
        furnishing: "unfurnished",
        energyRating: "D",
        amenities: ["sklep"],
        imageUrls: ["https://picsum.photos/800/600?random=4"],
        thumbnailUrl: "https://picsum.photos/400/300?random=4",
        sourceUrl: "https://www.bezrealitky.cz/nabidka/67890",
        listedAt: "2025-11-28 08:00:00",
        scrapedAt: "2025-11-28 12:00:00",
        createdAt: "2025-11-28 12:00:00",
        isActive: 1,
        deactivatedAt: nil
    )

    static let listings = [listing, listing2]

    static let markerListing = MarkerListing(
        id: 1,
        title: "Pronájem bytu 2+kk 55 m²",
        price: 18500,
        thumbnailUrl: "https://picsum.photos/400/300?random=1",
        propertyType: "flat",
        transactionType: "rent",
        layout: "2+kk",
        sizeM2: 55,
        city: "Praha",
        lat: 50.0755,
        lng: 14.4378
    )

    static let markerCluster = MarkerCluster(
        lat: 50.0755,
        lng: 14.4378,
        count: 5,
        listings: [markerListing]
    )

    static let watchdog = Watchdog(
        id: 1,
        email: "test@example.com",
        filters: ["transaction_type": "rent", "property_type": "flat", "location": "Praha"],
        label: "Praha pronájem",
        active: true,
        createdAt: "2025-12-01 10:00:00",
        lastNotifiedAt: nil
    )

    static let stats = StatsResponse(
        total: 1250,
        totalAll: 1500,
        inactive: 250,
        bySource: ["sreality": 600, "bezrealitky": 400, "ulovdomov": 250],
        byType: ["flat": 800, "house": 300, "land": 100, "commercial": 50],
        byTransaction: ["rent": 700, "sale": 550],
        byCity: ["Praha": 500, "Brno": 200, "Ostrava": 100, "Plzeň": 80, "Olomouc": 60]
    )
}
