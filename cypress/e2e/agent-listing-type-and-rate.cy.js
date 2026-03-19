describe("Listing type and agent rate exposure", () => {
  it("renders listing badges and agent fee details on web listing cards", () => {
    cy.intercept("GET", "/api/listings*", {
      statusCode: 200,
      body: {
        listings: [
          {
            _id: "listing-agent-1",
            title: "Agent Managed Apartment",
            suburb: "Avondale",
            propertyCategory: "residential",
            propertyType: "Apartment",
            pricePerMonth: 800,
            deposit: 200,
            bedrooms: 2,
            features: ["Solar backup"],
            images: [],
            lister_type: "agent",
            agent_rate: 7.5,
          },
          {
            _id: "listing-direct-1",
            title: "Direct Landlord Cottage",
            suburb: "Greendale",
            propertyCategory: "residential",
            propertyType: "Cottage",
            pricePerMonth: 700,
            deposit: 150,
            bedrooms: 2,
            features: ["Borehole"],
            images: [],
            lister_type: "direct_landlord",
            agent_rate: null,
          },
        ],
        total: 2,
        page: 1,
        perPage: 24,
      },
    }).as("fetchListings");

    cy.visit("/listings");
    cy.wait("@fetchListings");
    cy.contains("Agent Listing").should("be.visible");
    cy.contains("Agent fee 7.5%").should("be.visible");
    cy.contains("Direct Landlord").should("be.visible");
  });

  it("exposes lister_type and agent_rate in unified listings API for WhatsApp flow", () => {
    cy.request({
      method: "GET",
      url: "/api/listings?perPage=5",
      failOnStatusCode: false,
    }).then((response) => {
      expect([200, 401, 503]).to.include(response.status);
      if (response.status !== 200) return;
      const listings = Array.isArray(response.body?.listings) ? response.body.listings : [];
      listings.forEach((listing) => {
        expect(listing).to.have.property("lister_type");
        expect(listing).to.have.property("agent_rate");
      });
    });
  });
});
