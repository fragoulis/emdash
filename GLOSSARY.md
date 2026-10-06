# EmDash sites

Terms for managing multiple sites in one EmDash installation.

## Language

**Site**:
A blog with its own content, Astro pages, and theme. A site may have more than one hostname.
_Avoid_: Tenant, blog (when discussing access or data ownership)

**Site membership**:
The association between a user and a site that grants one of EmDash's existing roles on that site.
_Avoid_: Global role

**Site presentation**:
The Astro pages and theme used to render a site. A site can have a production and a staging presentation that use the same content.
_Avoid_: Staging site

**Site admin**:
A user with EmDash's existing admin role on a particular site.
_Avoid_: Super admin

**Super admin**:
A user with system-wide authority to manage sites and access their admin panels without site membership.
_Avoid_: Site admin
