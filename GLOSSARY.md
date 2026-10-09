# EmDash sites

Terms for managing multiple sites in one EmDash installation.

## Language

**Site**:
A blog with its own content, Astro pages, and theme. A site may have more than one hostname.
_Avoid_: Tenant, blog (when discussing access or data ownership)

**Admin area**:
The shared interface where staff sign in and manage sites. It has its own hostname, separate from public site hostnames.

**Site subdomain**:
A public hostname assigned to a site under the installation's shared domain. It works before the site has a custom domain.

**Site setting**:
A value owned by one site, such as its title, public URL, or SEO defaults. Different sites may use the same setting name with different values.

**Installation-wide setting**:
A value shared by all sites, such as plugin configuration. It has no site owner.

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
