inbox.evoadmissions.com {
	encode zstd gzip
	reverse_proxy evo-inbox-app:3000
	header {
		-Server
	}
}
